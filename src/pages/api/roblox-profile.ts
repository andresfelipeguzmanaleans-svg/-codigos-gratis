import type { APIRoute } from 'astro';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username) {
    return json({ error: 'El parámetro "username" es obligatorio.' }, 400);
  }

  const trimmed = username.trim();
  if (trimmed.length < 1 || trimmed.length > 20) {
    return json({ error: 'El nombre de usuario debe tener entre 1 y 20 caracteres.' }, 400);
  }

  try {
    // Step 1: Find user
    let userId: number | null = null;
    let exactMatch = false;

    const exactRes = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [trimmed], excludeBannedUsers: false }),
    });

    if (exactRes.ok) {
      const exactData = await exactRes.json();
      if (exactData.data && exactData.data.length > 0) {
        userId = exactData.data[0].id;
        exactMatch = true;
      }
    }

    if (!userId) {
      const searchRes = await fetch(
        `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(trimmed)}&limit=1`,
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.data && searchData.data.length > 0) {
          userId = searchData.data[0].id;
        }
      }
    }

    if (!userId) {
      return json({ error: 'Usuario no encontrado.' }, 404);
    }

    // Step 2: Parallel batch — all primary data
    const [userRes, headshotRes, fullAvatarRes, friendsRes, followersRes, followingRes, wearingRes, gamesRes] =
      await Promise.all([
        fetch(`https://users.roblox.com/v1/users/${userId}`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=352x352&format=Png`),
        fetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
        fetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
        fetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
        fetch(`https://avatar.roblox.com/v1/users/${userId}/currently-wearing`).catch(() => null),
        fetch(`https://games.roblox.com/v2/users/${userId}/games?sortOrder=Desc&limit=10`).catch(() => null),
      ]);

    const userData = await userRes.json();
    const headshotData = await headshotRes.json();
    const fullAvatarData = await fullAvatarRes.json();
    const friendsData = await friendsRes.json();
    const followersData = await followersRes.json();
    const followingData = await followingRes.json();
    const wearingData = wearingRes && wearingRes.ok ? await wearingRes.json() : { assetIds: [] };
    const gamesData = gamesRes && gamesRes.ok ? await gamesRes.json() : { data: [] };

    // Step 3: Wearing items — details + thumbnails
    let wearing: any[] = [];
    const assetIds: number[] = wearingData.assetIds || [];
    if (assetIds.length > 0) {
      try {
        const [catalogRes, itemThumbRes] = await Promise.all([
          fetch('https://catalog.roblox.com/v1/catalog/items/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: assetIds.map((id) => ({ itemType: 'Asset', id })) }),
          }).catch(() => null),
          fetch(
            `https://thumbnails.roblox.com/v1/assets?assetIds=${assetIds.join(',')}&size=150x150&format=Png`,
          ).catch(() => null),
        ]);

        const catalogData = catalogRes && catalogRes.ok ? await catalogRes.json() : { data: [] };
        const itemThumbData = itemThumbRes && itemThumbRes.ok ? await itemThumbRes.json() : { data: [] };

        const nameMap: Record<number, string> = {};
        if (catalogData.data) {
          for (const item of catalogData.data) nameMap[item.id] = item.name || '';
        }

        const thumbMap: Record<number, string | null> = {};
        if (itemThumbData.data) {
          for (const t of itemThumbData.data) thumbMap[t.targetId] = t.imageUrl || null;
        }

        wearing = assetIds.map((id) => ({
          id,
          name: nameMap[id] || `Item ${id}`,
          thumbnail: thumbMap[id] || null,
        }));
      } catch {
        wearing = assetIds.map((id) => ({ id, name: `Item ${id}`, thumbnail: null }));
      }
    }

    // Step 4: Games — thumbnails + votes + playing
    let games: any[] = [];
    const rawGames = gamesData.data || [];
    if (rawGames.length > 0) {
      try {
        const universeIds = rawGames.map((g: any) => g.id);
        const [gameThumbRes, gameVotesRes, gamePlayingRes] = await Promise.all([
          fetch(
            `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeIds.join(',')}&size=150x150&format=Png`,
          ).catch(() => null),
          fetch(`https://games.roblox.com/v1/games/votes?universeIds=${universeIds.join(',')}`).catch(() => null),
          fetch(`https://games.roblox.com/v1/games?universeIds=${universeIds.join(',')}`).catch(() => null),
        ]);

        const gameThumbData = gameThumbRes && gameThumbRes.ok ? await gameThumbRes.json() : { data: [] };
        const gameVotesData = gameVotesRes && gameVotesRes.ok ? await gameVotesRes.json() : { data: [] };
        const gamePlayingData = gamePlayingRes && gamePlayingRes.ok ? await gamePlayingRes.json() : { data: [] };

        const gThumbMap: Record<number, string | null> = {};
        if (gameThumbData.data) {
          for (const t of gameThumbData.data) gThumbMap[t.targetId] = t.imageUrl || null;
        }

        const gVotesMap: Record<number, { up: number; down: number }> = {};
        if (gameVotesData.data) {
          for (const v of gameVotesData.data) gVotesMap[v.id] = { up: v.upVotes || 0, down: v.downVotes || 0 };
        }

        const gPlayingMap: Record<number, number> = {};
        if (gamePlayingData.data) {
          for (const p of gamePlayingData.data) gPlayingMap[p.id] = p.playing || 0;
        }

        games = rawGames.map((g: any) => ({
          id: g.id,
          rootPlaceId: g.rootPlace?.id || null,
          name: g.name || '',
          visits: g.placeVisits || 0,
          playing: gPlayingMap[g.id] || 0,
          likes: gVotesMap[g.id]?.up || 0,
          thumbnail: gThumbMap[g.id] || null,
        }));
      } catch {
        games = rawGames.map((g: any) => ({
          id: g.id, rootPlaceId: g.rootPlace?.id || null,
          name: g.name || '', visits: g.placeVisits || 0,
          playing: 0, likes: 0, thumbnail: null,
        }));
      }
    }

    const result = {
      id: userData.id,
      name: userData.name,
      displayName: userData.displayName,
      description: userData.description || '',
      created: userData.created,
      isBanned: userData.isBanned || false,
      hasVerifiedBadge: userData.hasVerifiedBadge || false,
      exactMatch,
      avatarUrl: headshotData.data?.[0]?.imageUrl || null,
      avatarFullUrl: fullAvatarData.data?.[0]?.imageUrl || null,
      friends: friendsData.count ?? 0,
      followers: followersData.count ?? 0,
      following: followingData.count ?? 0,
      wearing,
      games,
    };

    return json(result, 200, { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' });
  } catch (err) {
    console.error('Roblox API error:', err);
    return json({ error: 'Error al consultar la API de Roblox. Inténtalo de nuevo.' }, 500);
  }
};
