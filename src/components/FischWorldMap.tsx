import { useState, useMemo, useEffect, useRef } from 'react';

/* ================================================================
   FischWorldMap — Grouped island map (div-based, ~20 nodes)
   Matches the fisch-map-mockup.html design exactly
   ================================================================ */

interface FishEntry { name: string; rarity: string; id?: string; }
interface MapLocation {
  id: string; name: string; fishCount: number;
  isPremium: boolean; isEvent: boolean; isSeasonal: boolean;
  coords: { x: number; z: number } | null;
  imagePath: string | null; fish: FishEntry[]; availableWeathers: string[];
}
interface Props { locations: MapLocation[]; gameSlug: string; }

// ---- Rarity ----
const RARITY_ORDER: Record<string, number> = {
  'Divine Secret':17,'Gemstone':16,'Fragment':15,'Relic':14,'Apex':13,
  'Special':12,'Limited':11,'Extinct':10,'Secret':9,'Exotic':8,
  'Mythical':7,'Legendary':6,'Rare':5,'Unusual':4,'Uncommon':3,'Common':2,'Trash':1,
};
const RARITY_COLORS: Record<string, string> = {
  'Trash':'#808080','Common':'#94a3b8','Uncommon':'#22c55e','Unusual':'#6366f1',
  'Rare':'#3b82f6','Legendary':'#f97316','Mythical':'#ef4444','Exotic':'#a855f7',
  'Secret':'#1ABC9C','Relic':'#CD7F32','Fragment':'#E056A0','Gemstone':'#00FFFF',
  'Extinct':'#5D6D7E','Limited':'#facc15','Apex':'#FF4500','Special':'#FF69B4',
  'Divine Secret':'#FFE066',
};
function slugify(n: string) { return n.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function bestRarity(fish: FishEntry[]): string {
  let b = 'Common', bo = 0;
  for (const f of fish) { const o = RARITY_ORDER[f.rarity]||0; if (o > bo) { bo = o; b = f.rarity; } }
  return b;
}
function glowClass(rarity: string): string {
  const o = RARITY_ORDER[rarity] || 0;
  if (o >= 8) return 'fwm-glow--exotic';
  if (o >= 7) return 'fwm-glow--mythical';
  if (o >= 6) return 'fwm-glow--legendary';
  if (o >= 5) return 'fwm-glow--rare';
  return '';
}

// Weather colors
const WEATHER_CLASS: Record<string, string> = {
  'Sunny':'fwm-wc--sunny','Rain':'fwm-wc--rain','Thunder':'fwm-wc--thunder',
  'Wind':'fwm-wc--wind','Foggy':'fwm-wc--foggy','Blizzard':'fwm-wc--blizzard',
  'Snow':'fwm-wc--snow','Any':'fwm-wc--any',
};
const WEATHER_ICON: Record<string, string> = {
  'Sunny':'☀️','Rain':'🌧️','Thunder':'⛈️','Wind':'💨','Foggy':'🌫️',
  'Blizzard':'🌨️','Snow':'❄️','Any':'🌤️',
};

// ---- Island groups ----
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; left: string; top: string;
  sea: 'first' | 'second' | 'deep'; size?: 'small' | 'large';
}

const ISLAND_GROUPS: IslandGroup[] = [
  // First Sea
  { id: 'sunstone-island', name: 'Sunstone Island',   icon: '☀️', biome: 'sand',     children: ['sunstone-island','desolate-deep'], left: '12%', top: '14%', sea: 'first' },
  { id: 'northern-caves',  name: 'Northern Caves',    icon: '🦇', biome: 'dark',     children: ['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], left: '32%', top: '8%', sea: 'deep', size: 'small' },
  { id: 'castaway-cliffs', name: 'Castaway Cliffs',   icon: '🪨', biome: 'tropical', children: ['castaway-cliffs'], left: '50%', top: '6%', sea: 'first', size: 'small' },
  { id: 'emberreach',      name: 'Emberreach',        icon: '🔥', biome: 'volcanic', children: ['emberreach'], left: '64%', top: '10%', sea: 'first', size: 'small' },
  { id: 'ancient-isle',    name: 'Ancient Isle',      icon: '🏛️', biome: 'sand',     children: ['ancient-isle'], left: '82%', top: '12%', sea: 'first' },
  { id: 'keepers-altar',   name: "Keeper's Altar",    icon: '⛩️', biome: 'mystic',   children: ['keepers-altar'], left: '24%', top: '26%', sea: 'first', size: 'small' },
  { id: 'the-ocean',       name: 'The Ocean',         icon: '🌊', biome: 'ocean',    children: ['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], left: '38%', top: '28%', sea: 'first' },
  { id: 'roslit-bay',      name: 'Roslit Bay',        icon: '🌋', biome: 'volcanic', children: ['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], left: '6%', top: '40%', sea: 'first', size: 'large' },
  { id: 'moosewood',       name: 'Moosewood',         icon: '🏠', biome: 'tropical', children: ['moosewood','executive-lake','isle-of-new-beginnings'], left: '44%', top: '40%', sea: 'first', size: 'large' },
  { id: 'lushgrove',       name: 'Lushgrove',         icon: '🌿', biome: 'tropical', children: ['lushgrove'], left: '58%', top: '30%', sea: 'first' },
  { id: 'mushgrove-swamp', name: 'Mushgrove Swamp',   icon: '🍄', biome: 'swamp',    children: ['mushgrove-swamp'], left: '72%', top: '32%', sea: 'first' },
  { id: 'cursed-isle',     name: 'Cursed Isle',       icon: '💀', biome: 'dark',     children: ['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], left: '86%', top: '38%', sea: 'first', size: 'small' },
  { id: 'forsaken-shores', name: 'Forsaken Shores',   icon: '🏝️', biome: 'sand',     children: ['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], left: '8%', top: '64%', sea: 'first' },
  { id: 'deep-trenches',   name: 'Deep Trenches',     icon: '🕳️', biome: 'dark',     children: ['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], left: '22%', top: '58%', sea: 'deep', size: 'small' },
  { id: 'vertigo',         name: 'Vertigo',           icon: '🌀', biome: 'dark',     children: ['vertigo','the-depths'], left: '34%', top: '60%', sea: 'first', size: 'small' },
  { id: 'terrapin-island', name: 'Terrapin Island',   icon: '🐢', biome: 'tropical', children: ['terrapin-island','pine-shoals','carrot-garden'], left: '50%', top: '62%', sea: 'first' },
  { id: 'azure-lagoon',    name: 'Azure Lagoon',      icon: '💎', biome: 'ocean',    children: ['azure-lagoon'], left: '64%', top: '56%', sea: 'first', size: 'small' },
  { id: 'snowcap-island',  name: 'Snowcap Island',    icon: '❄️', biome: 'snow',     children: ['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], left: '78%', top: '60%', sea: 'first', size: 'large' },
  // Second Sea
  { id: 'waveborne',       name: 'Waveborne',         icon: '⛵', biome: 'mystic',   children: ['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], left: '38%', top: '82%', sea: 'second' },
  { id: 'treasure-island', name: 'Treasure Island',   icon: '💰', biome: 'sand',     children: ['treasure-island'], left: '62%', top: '82%', sea: 'second', size: 'small' },
];

const EVENT_IDS = ['admin-events','fischfright-2025','winter-village','lego-event-2025','fischgiving-2025'];
const EVENT_ICONS: Record<string, string> = {
  'admin-events':'⭐','fischfright-2025':'🎃','winter-village':'🎄','lego-event-2025':'🧱','fischgiving-2025':'🦃',
};

// ---- Component ----
export default function FischWorldMap({ locations, gameSlug }: Props) {
  const locMap = useMemo(() => {
    const m = new Map<string, MapLocation>();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

  const [filter, setFilter] = useState<'all'|'first'|'second'|'deep'>('all');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [selEventId, setSelEventId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build group data
  const groupData = useMemo(() => {
    return ISLAND_GROUPS.map(g => {
      const childLocs = g.children.map(id => locMap.get(id)).filter(Boolean) as MapLocation[];
      const allFish = childLocs.flatMap(l => l.fish);
      const totalFish = childLocs.reduce((s, l) => s + l.fishCount, 0);
      const primaryLoc = locMap.get(g.children[0]) || childLocs[0];
      const imagePath = primaryLoc?.imagePath || childLocs.find(l => l.imagePath)?.imagePath || null;
      const isPremium = childLocs.some(l => l.isPremium);
      const isSeasonal = childLocs.some(l => l.isSeasonal);
      const weathers = Array.from(new Set(childLocs.flatMap(l => l.availableWeathers)));
      const coords = primaryLoc?.coords || null;
      const topRarity = allFish.length > 0 ? bestRarity(allFish) : 'Common';
      return { ...g, childLocs, allFish, totalFish, imagePath, isPremium, isSeasonal, weathers, coords, topRarity };
    });
  }, [locMap]);

  const eventLocs = useMemo(() =>
    EVENT_IDS.map(id => locMap.get(id)).filter(Boolean) as MapLocation[]
  , [locMap]);

  // URL param
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groupData.find(g => g.id === loc);
    if (direct) { setSelId(direct.id); return; }
    const parent = groupData.find(g => g.children.includes(loc));
    if (parent) { setSelId(parent.id); setActiveTab(loc); }
  }, [groupData]);

  // Scroll to panel
  useEffect(() => {
    if ((selId || selEventId) && panelRef.current) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }, [selId, selEventId]);

  // Filtered groups
  const visibleGroups = useMemo(() => {
    return groupData.filter(g => {
      if (filter === 'first' && g.sea !== 'first') return false;
      if (filter === 'second' && g.sea !== 'second') return false;
      if (filter === 'deep' && g.sea !== 'deep') return false;
      if (search) {
        const q = search.toLowerCase();
        if (!g.name.toLowerCase().includes(q) &&
            !g.childLocs.some(l => l.name.toLowerCase().includes(q)) &&
            !g.allFish.some(f => f.name.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [groupData, filter, search]);
  const visibleIds = useMemo(() => new Set(visibleGroups.map(g => g.id)), [visibleGroups]);

  const selected = useMemo(() => groupData.find(g => g.id === selId) || null, [groupData, selId]);
  const selectedEvent = useMemo(() => selEventId ? locMap.get(selEventId) || null : null, [selEventId, locMap]);

  // Fish lists
  const selectedFish = useMemo(() => {
    if (!selected) return [];
    let fish: FishEntry[];
    if (activeTab) {
      const tabLoc = locMap.get(activeTab);
      fish = tabLoc ? [...tabLoc.fish] : [];
    } else {
      fish = [...selected.allFish];
    }
    fish.sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selected, activeTab, rarityFilter, locMap]);

  const selectedRarities = useMemo(() => {
    if (!selected) return [];
    const src = activeTab ? (locMap.get(activeTab)?.fish || []) : selected.allFish;
    return Array.from(new Set(src.map(f => f.rarity)))
      .sort((a, b) => (RARITY_ORDER[b]||0) - (RARITY_ORDER[a]||0));
  }, [selected, activeTab, locMap]);

  const eventFish = useMemo(() => {
    if (!selectedEvent) return [];
    let fish = [...selectedEvent.fish].sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selectedEvent, rarityFilter]);
  const eventRarities = useMemo(() => {
    if (!selectedEvent) return [];
    return Array.from(new Set(selectedEvent.fish.map(f => f.rarity)))
      .sort((a, b) => (RARITY_ORDER[b]||0) - (RARITY_ORDER[a]||0));
  }, [selectedEvent]);

  const handleGroupClick = (id: string) => {
    setSelEventId(null); setRarityFilter(null); setActiveTab(null);
    setSelId(prev => prev === id ? null : id);
  };
  const handleEventClick = (id: string) => {
    setSelId(null); setActiveTab(null); setRarityFilter(null);
    setSelEventId(prev => prev === id ? null : id);
  };
  const closePanel = () => { setSelId(null); setSelEventId(null); setActiveTab(null); setRarityFilter(null); };

  const totalFish = groupData.reduce((s, g) => s + g.totalFish, 0) + eventLocs.reduce((s, l) => s + l.fishCount, 0);

  // ---- Panel renderer (shared for group and event) ----
  function renderPanel(
    title: string, fishCount: number, imagePath: string | null,
    imageIcon: string, imageBiome: string,
    coords: { x: number; z: number } | null,
    weathers: string[], rarities: string[], fishList: FishEntry[],
    badges: JSX.Element, tabs: JSX.Element | null, viewAllHref: string
  ) {
    return (
      <div className="fwm-detail" ref={panelRef}>
        <div className="fwm-card">
          <div className="fwm-card__head">
            {imagePath ? (
              <img src={imagePath} alt={title} className="fwm-card__img"/>
            ) : (
              <div className={`fwm-card__ph fwm-biome--${imageBiome}`}>{imageIcon}</div>
            )}
            <div className="fwm-card__info">
              <h2 className="fwm-card__title">{title}</h2>
              <div className="fwm-card__meta">
                <span className="fwm-card__fc">🐟 {fishCount} fish</span>
                {badges}
                {coords && <span className="fwm-card__coords">X: {coords.x} &bull; Z: {coords.z}</span>}
              </div>
            </div>
            <button className="fwm-card__close" onClick={closePanel}>✕</button>
          </div>

          {tabs}

          {weathers.length > 0 && (
            <div className="fwm-card__weath">
              <span className="fwm-card__wlbl">Weather:</span>
              {weathers.map(w => (
                <span key={w} className={`fwm-wc ${WEATHER_CLASS[w]||'fwm-wc--any'}`}>
                  {WEATHER_ICON[w]||'🌤️'} {w}
                </span>
              ))}
            </div>
          )}

          {rarities.length > 1 && (
            <div className="fwm-card__rpills">
              <button onClick={() => setRarityFilter(null)}
                className={`fwm-rpill${!rarityFilter?' fwm-rpill--on':''}`}>All</button>
              {rarities.map(r => (
                <button key={r} onClick={() => setRarityFilter(rarityFilter===r?null:r)}
                  className={`fwm-rpill${rarityFilter===r?' fwm-rpill--on':''}`}
                  style={rarityFilter===r?{borderColor:RARITY_COLORS[r],color:RARITY_COLORS[r]}:{}}>
                  {r}
                </button>
              ))}
            </div>
          )}

          <div className="fwm-card__flist">
            {fishList.length === 0 && <p className="fwm-card__empty">No fish data available</p>}
            {fishList.map((f, i) => (
              <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${f.id || slugify(f.name)}/`} className="fwm-fi">
                <span className="fwm-fi__dot" style={{background: RARITY_COLORS[f.rarity]||'#94a3b8'}}/>
                <span className="fwm-fi__name">{f.name}</span>
                <span className="fwm-fi__rar" style={{color: RARITY_COLORS[f.rarity]||'#94a3b8'}}>{f.rarity}</span>
              </a>
            ))}
          </div>

          <a href={viewAllHref} className="fwm-card__viewall">View all fish in {title} →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="fwm">
      {/* Controls */}
      <div className="fwm-controls">
        <input type="text" className="fwm-search" placeholder="Search island or fish..."
          value={search} onChange={e => setSearch(e.target.value)}/>
        <div className="fwm-pills">
          {(['all','first','second','deep'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`fwm-pill${filter===f?' fwm-pill--on':''}`}>
              {f==='all'?'All':f==='first'?'First Sea':f==='second'?'Second Sea':'Deep'}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="fwm-ocean">
        <div className="fwm-grid"/>
        <div className="fwm-wave1"/>
        <div className="fwm-wave2"/>
        <span className="fwm-region fwm-region--first">— First Sea —</span>
        <span className="fwm-region fwm-region--second">— Second Sea —</span>
        <div className="fwm-compass"/>

        {groupData.map(g => {
          const vis = visibleIds.has(g.id);
          const isSel = selId === g.id;
          const glow = glowClass(g.topRarity);
          const sizeClass = g.size ? ` fwm-isle--${g.size}` : '';

          return (
            <div key={g.id}
              className={`fwm-isle${sizeClass}${glow ? ` ${glow}` : ''}${isSel ? ' fwm-isle--sel' : ''}`}
              style={{ left: g.left, top: g.top, opacity: vis ? 1 : 0.15 }}
              onClick={() => vis && handleGroupClick(g.id)}>
              <div className="fwm-isle__circle">
                {g.imagePath ? (
                  <img src={g.imagePath} alt={g.name} className="fwm-isle__img"/>
                ) : (
                  <div className={`fwm-isle__ph fwm-biome--${g.biome}`}>{g.icon}</div>
                )}
              </div>
              <span className="fwm-isle__name">{g.name}</span>
              {g.totalFish > 0 && <span className="fwm-isle__badge">{g.totalFish} fish</span>}
            </div>
          );
        })}
      </div>

      {/* Detail Panel — group */}
      {selected && renderPanel(
        selected.name, selected.totalFish, selected.imagePath,
        selected.icon, selected.biome, selected.coords,
        selected.weathers, selectedRarities, selectedFish,
        <>
          {selected.isPremium && <span className="fwm-badge fwm-badge--p">Premium</span>}
          {selected.isSeasonal && <span className="fwm-badge fwm-badge--s">Seasonal</span>}
        </>,
        selected.childLocs.length > 1 ? (
          <div className="fwm-stabs">
            <button onClick={() => { setActiveTab(null); setRarityFilter(null); }}
              className={`fwm-stab${!activeTab?' fwm-stab--on':''}`}>All Zones</button>
            {selected.childLocs.map(loc => (
              <button key={loc.id} onClick={() => { setActiveTab(loc.id); setRarityFilter(null); }}
                className={`fwm-stab${activeTab===loc.id?' fwm-stab--on':''}`}>
                {loc.name}
              </button>
            ))}
          </div>
        ) : null,
        `/games/${gameSlug}/locations/${selected.children[0]}/`
      )}

      {/* Detail Panel — event */}
      {selectedEvent && renderPanel(
        selectedEvent.name, selectedEvent.fishCount, selectedEvent.imagePath,
        EVENT_ICONS[selEventId!] || '🎉', 'dark', selectedEvent.coords,
        selectedEvent.availableWeathers, eventRarities, eventFish,
        <><span className="fwm-badge fwm-badge--e">Event</span><span className="fwm-badge fwm-badge--lim">Limited</span></>,
        null,
        `/games/${gameSlug}/locations/${selEventId}/`
      )}

      {/* Event cards */}
      {eventLocs.length > 0 && (
        <div className="fwm-events">
          <div className="fwm-events__title">⚡ Event Locations</div>
          <div className="fwm-events__row">
            {eventLocs.map(loc => (
              <button key={loc.id} onClick={() => handleEventClick(loc.id)}
                className={`fwm-evt${selEventId===loc.id?' fwm-evt--on':''}`}>
                <span className="fwm-evt__icon">{EVENT_ICONS[loc.id] || '🎉'}</span>
                <span className="fwm-evt__name">{loc.name}</span>
                <span className="fwm-evt__badge">ENDED</span>
                {loc.fishCount > 0 && <span className="fwm-evt__fish">{loc.fishCount} fish</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
