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
    // Step 1: Try exact username lookup first
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

    // Step 2: Fallback to search API
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

    // Step 3: Fetch all details in parallel
    const [userRes, avatarRes, friendsRes, followersRes, followingRes] = await Promise.all([
      fetch(`https://users.roblox.com/v1/users/${userId}`),
      fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`),
      fetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
      fetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
      fetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
    ]);

    const [userData, avatarData, friendsData, followersData, followingData] = await Promise.all([
      userRes.json(),
      avatarRes.json(),
      friendsRes.json(),
      followersRes.json(),
      followingRes.json(),
    ]);

    const avatarUrl = avatarData.data?.[0]?.imageUrl || null;

    const result = {
      id: userData.id,
      name: userData.name,
      displayName: userData.displayName,
      description: userData.description || '',
      created: userData.created,
      isBanned: userData.isBanned || false,
      hasVerifiedBadge: userData.hasVerifiedBadge || false,
      exactMatch,
      avatarUrl,
      friends: friendsData.count ?? 0,
      followers: followersData.count ?? 0,
      following: followingData.count ?? 0,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Roblox API error:', err);
    return res.status(500).json({ error: 'Error al consultar la API de Roblox. Inténtalo de nuevo.' });
  }
}
