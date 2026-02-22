export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { username } = req.query;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'El parámetro "username" es obligatorio.' });
  }

  const trimmed = username.trim();

  if (trimmed.length < 1 || trimmed.length > 20) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener entre 1 y 20 caracteres.' });
  }

  try {
    // Step 1: Find user
    let userId = null;
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
        `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(trimmed)}&limit=1`
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.data && searchData.data.length > 0) {
          userId = searchData.data[0].id;
        }
      }
    }

    if (!userId) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
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
    let wearing = [];
    const assetIds = wearingData.assetIds || [];
    if (assetIds.length > 0) {
      try {
        const [catalogRes, itemThumbRes] = await Promise.all([
          fetch('https://catalog.roblox.com/v1/catalog/items/details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: assetIds.map((id) => ({ itemType: 'Asset', id })) }),
          }).catch(() => null),
          fetch(
            `https://thumbnails.roblox.com/v1/assets?assetIds=${assetIds.join(',')}&size=150x150&format=Png`
          ).catch(() => null),
        ]);

        const catalogData = catalogRes && catalogRes.ok ? await catalogRes.json() : { data: [] };
        const itemThumbData = itemThumbRes && itemThumbRes.ok ? await itemThumbRes.json() : { data: [] };

        const nameMap = {};
        if (catalogData.data) {
          for (const item of catalogData.data) {
            nameMap[item.id] = item.name || '';
          }
        }

        const thumbMap = {};
        if (itemThumbData.data) {
          for (const t of itemThumbData.data) {
            thumbMap[t.targetId] = t.imageUrl || null;
          }
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
    let games = [];
    const rawGames = gamesData.data || [];
    if (rawGames.length > 0) {
      try {
        const universeIds = rawGames.map((g) => g.id);
        const [gameThumbRes, gameVotesRes, gamePlayingRes] = await Promise.all([
          fetch(
            `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeIds.join(',')}&size=150x150&format=Png`
          ).catch(() => null),
          fetch(`https://games.roblox.com/v1/games/votes?universeIds=${universeIds.join(',')}`).catch(() => null),
          fetch(`https://games.roblox.com/v1/games?universeIds=${universeIds.join(',')}`).catch(() => null),
        ]);

        const gameThumbData = gameThumbRes && gameThumbRes.ok ? await gameThumbRes.json() : { data: [] };
        const gameVotesData = gameVotesRes && gameVotesRes.ok ? await gameVotesRes.json() : { data: [] };
        const gamePlayingData = gamePlayingRes && gamePlayingRes.ok ? await gamePlayingRes.json() : { data: [] };

        const gThumbMap = {};
        if (gameThumbData.data) {
          for (const t of gameThumbData.data) gThumbMap[t.targetId] = t.imageUrl || null;
        }

        const gVotesMap = {};
        if (gameVotesData.data) {
          for (const v of gameVotesData.data) gVotesMap[v.id] = { up: v.upVotes || 0, down: v.downVotes || 0 };
        }

        const gPlayingMap = {};
        if (gamePlayingData.data) {
          for (const p of gamePlayingData.data) gPlayingMap[p.id] = p.playing || 0;
        }

        games = rawGames.map((g) => ({
          id: g.id,
          rootPlaceId: g.rootPlace?.id || null,
          name: g.name || '',
          visits: g.placeVisits || 0,
          playing: gPlayingMap[g.id] || 0,
          likes: gVotesMap[g.id]?.up || 0,
          thumbnail: gThumbMap[g.id] || null,
        }));
      } catch {
        games = rawGames.map((g) => ({
          id: g.id,
          rootPlaceId: g.rootPlace?.id || null,
          name: g.name || '',
          visits: g.placeVisits || 0,
          playing: 0,
          likes: 0,
          thumbnail: null,
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Roblox API error:', err);
    return res.status(500).json({ error: 'Error al consultar la API de Roblox. Inténtalo de nuevo.' });
  }
}
