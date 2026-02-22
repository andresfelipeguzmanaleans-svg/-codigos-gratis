export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'El parámetro "url" es obligatorio.' });
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'URL inválida. Pega un enlace de roblox.com.' });
  }

  if (!parsed.hostname.includes('roblox.com')) {
    return res.status(400).json({ error: 'La URL debe ser de roblox.com.' });
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  // Detect type and extract primary ID
  let type = null;
  let primaryId = null;

  const patterns = [
    { regex: /^\/games\/(\d+)/, type: 'game' },
    { regex: /^\/users\/(\d+)/, type: 'user' },
    { regex: /^\/catalog\/(\d+)/, type: 'asset' },
    { regex: /^\/library\/(\d+)/, type: 'asset' },
    { regex: /^\/groups\/(\d+)/, type: 'group' },
    { regex: /^\/game-pass\/(\d+)/, type: 'gamepass' },
    { regex: /^\/bundles\/(\d+)/, type: 'bundle' },
    { regex: /^\/badges\/(\d+)/, type: 'badge' },
  ];

  for (const p of patterns) {
    const m = path.match(p.regex);
    if (m) {
      type = p.type;
      primaryId = m[1];
      break;
    }
  }

  if (!type || !primaryId) {
    return res.status(400).json({ error: 'No se pudo detectar el tipo de enlace. Usa un enlace de juego, usuario, item, grupo, game pass, bundle o badge.' });
  }

  try {
    let result = { type, ids: {}, meta: {} };

    if (type === 'game') {
      result.ids.placeId = primaryId;

      // Get Universe ID from Place ID
      const uniRes = await fetch(`https://apis.roblox.com/universes/v1/places/${primaryId}/universe`);
      let universeId = null;
      if (uniRes.ok) {
        const uniData = await uniRes.json();
        universeId = uniData.universeId;
        result.ids.universeId = String(universeId);
      }

      // Get game details
      if (universeId) {
        const [gameRes, thumbRes, votesRes] = await Promise.all([
          fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
          fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=150x150&format=Png`),
          fetch(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`),
        ]);

        const gameData = gameRes.ok ? await gameRes.json() : { data: [] };
        const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };
        const votesData = votesRes.ok ? await votesRes.json() : { data: [] };

        const game = gameData.data?.[0];
        if (game) {
          result.ids.creatorId = String(game.creator?.id || '');
          result.ids.creatorType = game.creator?.type || '';
          result.meta = {
            name: game.name || '',
            description: game.description || '',
            playing: game.playing || 0,
            visits: game.visits || 0,
            maxPlayers: game.maxPlayers || 0,
            created: game.created || '',
            updated: game.updated || '',
            genre: game.genre || '',
            creator: game.creator?.name || '',
          };
        }
        result.meta.thumbnail = thumbData.data?.[0]?.imageUrl || null;
        const votes = votesData.data?.[0];
        if (votes) {
          result.meta.likes = votes.upVotes || 0;
          result.meta.dislikes = votes.downVotes || 0;
        }
      }
    }

    else if (type === 'user') {
      result.ids.userId = primaryId;

      const [userRes, thumbRes] = await Promise.all([
        fetch(`https://users.roblox.com/v1/users/${primaryId}`),
        fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${primaryId}&size=150x150&format=Png`),
      ]);

      const userData = userRes.ok ? await userRes.json() : {};
      const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };

      result.meta = {
        name: userData.name || '',
        displayName: userData.displayName || '',
        description: userData.description || '',
        created: userData.created || '',
        isBanned: userData.isBanned || false,
        hasVerifiedBadge: userData.hasVerifiedBadge || false,
        thumbnail: thumbData.data?.[0]?.imageUrl || null,
      };
    }

    else if (type === 'asset') {
      result.ids.assetId = primaryId;

      const [detailRes, thumbRes] = await Promise.all([
        fetch(`https://economy.roblox.com/v2/assets/${primaryId}/details`),
        fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${primaryId}&size=150x150&format=Png`),
      ]);

      const detail = detailRes.ok ? await detailRes.json() : {};
      const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };

      if (detail.Creator) {
        result.ids.creatorId = String(detail.Creator.Id || '');
        result.ids.creatorType = detail.Creator.CreatorType || '';
      }
      result.meta = {
        name: detail.Name || '',
        description: detail.Description || '',
        assetType: detail.AssetTypeId ? assetTypeName(detail.AssetTypeId) : '',
        created: detail.Created || '',
        updated: detail.Updated || '',
        priceInRobux: detail.PriceInRobux ?? null,
        sales: detail.Sales || 0,
        isForSale: detail.IsForSale || false,
        creator: detail.Creator?.Name || '',
        thumbnail: thumbData.data?.[0]?.imageUrl || null,
      };
    }

    else if (type === 'group') {
      result.ids.groupId = primaryId;

      const groupRes = await fetch(`https://groups.roblox.com/v1/groups/${primaryId}`);
      const group = groupRes.ok ? await groupRes.json() : {};

      result.ids.ownerId = String(group.owner?.userId || '');
      result.meta = {
        name: group.name || '',
        description: group.description || '',
        memberCount: group.memberCount || 0,
        owner: group.owner?.username || '',
        isLocked: group.isLocked || false,
        thumbnail: null,
      };

      // Group icon
      const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${primaryId}&size=150x150&format=Png`).catch(() => null);
      if (thumbRes && thumbRes.ok) {
        const thumbData = await thumbRes.json();
        result.meta.thumbnail = thumbData.data?.[0]?.imageUrl || null;
      }
    }

    else if (type === 'gamepass') {
      result.ids.gamePassId = primaryId;

      const gpRes = await fetch(`https://economy.roblox.com/v1/game-passes/${primaryId}/game-pass-product-info`);
      const gp = gpRes.ok ? await gpRes.json() : {};

      if (gp.TargetId) result.ids.targetId = String(gp.TargetId);
      result.meta = {
        name: gp.Name || '',
        description: gp.Description || '',
        priceInRobux: gp.PriceInRobux ?? null,
        isForSale: gp.IsForSale || false,
        iconImageAssetId: gp.IconImageAssetId ? String(gp.IconImageAssetId) : null,
        thumbnail: null,
      };

      // Thumbnail from icon
      if (gp.IconImageAssetId) {
        const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${gp.IconImageAssetId}&size=150x150&format=Png`).catch(() => null);
        if (thumbRes && thumbRes.ok) {
          const thumbData = await thumbRes.json();
          result.meta.thumbnail = thumbData.data?.[0]?.imageUrl || null;
        }
      }
    }

    else if (type === 'bundle') {
      result.ids.bundleId = primaryId;

      const bRes = await fetch(`https://catalog.roblox.com/v1/bundles/${primaryId}/details`);
      const bundle = bRes.ok ? await bRes.json() : {};

      if (bundle.creator) {
        result.ids.creatorId = String(bundle.creator.id || '');
      }
      result.meta = {
        name: bundle.name || '',
        description: bundle.description || '',
        bundleType: bundle.bundleType || '',
        creator: bundle.creator?.name || '',
        thumbnail: null,
      };

      // Items in bundle
      if (bundle.items && bundle.items.length > 0) {
        result.ids.itemIds = bundle.items.map((i) => String(i.id)).join(', ');
      }
    }

    else if (type === 'badge') {
      result.ids.badgeId = primaryId;

      const bRes = await fetch(`https://badges.roblox.com/v1/badges/${primaryId}`);
      const badge = bRes.ok ? await bRes.json() : {};

      if (badge.awardingUniverse) {
        result.ids.universeId = String(badge.awardingUniverse.id || '');
        result.meta.gameName = badge.awardingUniverse.name || '';
      }
      result.meta.name = badge.name || '';
      result.meta.description = badge.description || '';
      result.meta.enabled = badge.enabled ?? true;
      result.meta.created = badge.created || '';
      result.meta.updated = badge.updated || '';

      if (badge.statistics) {
        result.meta.awardedCount = badge.statistics.awardedCount || 0;
        result.meta.winRatePercentage = badge.statistics.winRatePercentage || 0;
      }

      result.meta.thumbnail = null;
      const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${primaryId}&size=150x150&format=Png`).catch(() => null);
      if (thumbRes && thumbRes.ok) {
        const thumbData = await thumbRes.json();
        result.meta.thumbnail = thumbData.data?.[0]?.imageUrl || null;
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(result);
  } catch (err) {
    console.error('Roblox IDs API error:', err);
    return res.status(500).json({ error: 'Error al consultar la API de Roblox. Inténtalo de nuevo.' });
  }
}

function assetTypeName(id) {
  const map = {
    1: 'Image', 2: 'T-Shirt', 3: 'Audio', 4: 'Mesh', 5: 'Lua', 8: 'Hat',
    9: 'Place', 10: 'Model', 11: 'Shirt', 12: 'Pants', 13: 'Decal',
    17: 'Head', 18: 'Face', 19: 'Gear', 21: 'Badge', 24: 'Animation',
    27: 'Torso', 28: 'Right Arm', 29: 'Left Arm', 30: 'Left Leg',
    31: 'Right Leg', 32: 'Package', 34: 'Game Pass', 38: 'Plugin',
    40: 'MeshPart', 41: 'Hair Accessory', 42: 'Face Accessory',
    43: 'Neck Accessory', 44: 'Shoulder Accessory', 45: 'Front Accessory',
    46: 'Back Accessory', 47: 'Waist Accessory', 48: 'Climb Animation',
    49: 'Death Animation', 50: 'Fall Animation', 51: 'Idle Animation',
    52: 'Jump Animation', 53: 'Run Animation', 54: 'Swim Animation',
    55: 'Walk Animation', 56: 'Pose Animation', 61: 'Emote Animation',
    62: 'Video', 64: 'T-Shirt Accessory', 65: 'Shirt Accessory',
    66: 'Pants Accessory', 67: 'Jacket Accessory', 68: 'Sweater Accessory',
    69: 'Shorts Accessory', 70: 'Left Shoe Accessory', 71: 'Right Shoe Accessory',
    72: 'Dress Skirt Accessory', 76: 'Eyebrow Accessory', 77: 'Eyelash Accessory',
  };
  return map[id] || `Type ${id}`;
}
