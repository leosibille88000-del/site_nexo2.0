import { getStore } from "@netlify/blobs";

const TIKTOK = "nexo847";
const YOUTUBE = "nexo.847";
const CHANNEL_ID = "UCtX7eew_ORrhPgQeos9zALg";
const DISCORD_INVITE = "nexoxryzek";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const headers = { "user-agent": UA, "accept-language": "fr-FR,fr;q=0.9" };

const get = async url => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(url + " " + res.status);
  return res.text();
};

const parseCount = txt => {
  if (!txt) return null;
  const m = txt.replace(/ | /g, " ").match(/([\d\s.,]+)\s*(k|m|md|mio|millions?)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k") n *= 1e3;
  else if (unit.startsWith("m")) n *= 1e6;
  return Math.round(n);
};

async function tiktokVideos() {
  const html = await get("https://www.tiktok.com/embed/@" + TIKTOK);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const raw = scripts.find(s => s.includes('"authorUniqueId"') && s.trim().startsWith("{"));
  if (!raw) return [];
  const videos = [];
  JSON.stringify(JSON.parse(raw), (key, v) => {
    if (v && v.id && v.coverUrl && v.authorUniqueId && !videos.some(x => x.id === v.id)) {
      videos.push({ id: v.id, titre: v.desc || "", vues: v.playCount || 0, img: v.coverUrl });
    }
    return v;
  });
  if (videos.length > 1 && BigInt(videos[0].id) < BigInt(videos[1].id)) videos[0].epingle = true;
  return videos.slice(0, 8);
}

async function tiktok() {
  const [profile, videos] = await Promise.allSettled([get("https://www.tiktok.com/@" + TIKTOK), tiktokVideos()]);
  const out = { videos: videos.status === "fulfilled" ? videos.value : [] };
  if (profile.status === "fulfilled") {
    const html = profile.value;
    out.followers = Number((html.match(/"followerCount":(\d+)/) || [])[1]) || null;
    out.likes = Number((html.match(/"heartCount":(\d+)/) || [])[1]) || null;
    out.videoCount = Number((html.match(/"videoCount":(\d+)/) || [])[1]) || null;
    out.live = Boolean((html.match(/"roomId":"(\d+)"/) || [])[1]);
  }
  return out;
}

async function youtube() {
  const out = {};

  const page = await get("https://www.youtube.com/@" + YOUTUBE + "/videos?hl=fr");
  const subs = page.match(/"([\d\s.,  ]+\s*(?:k|M)?\s*abonnés)"/);
  out.subscribers = subs ? parseCount(subs[1]) : null;

  const data = JSON.parse(page.split("var ytInitialData = ")[1].split(";</script>")[0]);
  const videos = [];
  JSON.stringify(data, (key, v) => {
    if (v && v.contentId && v.metadata && videos.length < 3 && !videos.some(x => x.id === v.contentId)) {
      const meta = v.metadata.lockupMetadataViewModel;
      const raw = JSON.stringify(v);
      const parts = (meta?.metadata?.contentMetadataViewModel?.metadataRows || [])
        .flatMap(r => (r.metadataParts || []).map(p => p.text?.content)).filter(Boolean);
      videos.push({
        id: v.contentId,
        titre: meta?.title?.content || "",
        duree: (raw.match(/"text":"(\d+:\d\d(?::\d\d)?)"/) || [])[1] || "",
        vues: parts[0] ? parts[0].replace(/\s*vues?$/, "") + " vues" : ""
      });
    }
    return v;
  });

  if (!videos.length) {
    const rss = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL_ID);
    for (const m of rss.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>\s*<yt:channelId>[^<]*<\/yt:channelId>\s*<title>([^<]*)<\/title>/g)) {
      videos.push({ id: m[1], titre: m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") });
      if (videos.length === 3) break;
    }
  }
  out.videos = videos;

  const live = await get("https://www.youtube.com/@" + YOUTUBE + "/live");
  const liveId = (live.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
  out.live = Boolean(liveId && /"isLiveNow":true/.test(live));
  if (out.live) out.liveUrl = "https://www.youtube.com/watch?v=" + liveId;

  return out;
}

async function discord() {
  const res = await fetch("https://discord.com/api/v10/invites/" + DISCORD_INVITE + "?with_counts=true", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const d = await res.json();
  return { members: d.approximate_member_count || null, online: d.approximate_presence_count || null };
}

const ROBLOX_USER = 3437977804;
const ROBLOX_UNIVERSE = 9860707868;
const ROBLOX_GROUP = 569390323;

async function roblox() {
  const json = url => fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [fr, fo, game, group] = await Promise.all([
    json(`https://friends.roblox.com/v1/users/${ROBLOX_USER}/friends/count`),
    json(`https://friends.roblox.com/v1/users/${ROBLOX_USER}/followers/count`),
    json(`https://games.roblox.com/v1/games?universeIds=${ROBLOX_UNIVERSE}`),
    json(`https://groups.roblox.com/v1/groups/${ROBLOX_GROUP}`)
  ]);
  const g = game?.data?.[0];
  return {
    friends: fr?.count ?? null,
    followers: fo?.count ?? null,
    visits: g?.visits ?? null,
    favs: g?.favoritedCount ?? null,
    playing: g?.playing ?? null,
    members: group?.memberCount ?? null
  };
}

// Sauvegarde : si une source ne répond pas, on renvoie la dernière valeur connue
const DEPART = {
  tiktok: { followers: 60700, likes: 156500, videoCount: 65, live: false, videos: [] },
  youtube: { subscribers: 13700, videos: [], live: false },
  discord: null,
  roblox: { friends: 117, followers: 249, visits: 32720, favs: 190, members: 2597 }
};

const isEmpty = v => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

function merge(fresh, saved) {
  if (!fresh) return saved ?? null;
  if (!saved) return fresh;
  const out = { ...saved };
  for (const [k, v] of Object.entries(fresh)) {
    if (!isEmpty(v)) out[k] = v;
  }
  if (fresh.live !== undefined && fresh.live !== null) out.live = fresh.live;
  if (!fresh.live) delete out.liveUrl;
  return out;
}

export default async () => {
  const store = getStore("nexo-sauvegarde");
  const saved = (await store.get("stats", { type: "json" }).catch(() => null)) || { ...DEPART, updated: null };

  const [tt, yt, dc, rb] = await Promise.allSettled([tiktok(), youtube(), discord(), roblox()]);
  const val = r => r.status === "fulfilled" ? r.value : null;

  const fresh = { tiktok: val(tt), youtube: val(yt), discord: val(dc), roblox: val(rb) };
  const body = {
    updated: new Date().toISOString(),
    tiktok: merge(fresh.tiktok, saved.tiktok),
    youtube: merge(fresh.youtube, saved.youtube),
    discord: merge(fresh.discord, saved.discord),
    roblox: merge(fresh.roblox, saved.roblox),
    sources: Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, v ? "direct" : "sauvegarde"]))
  };

  await store.setJSON("stats", body).catch(() => {});

  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=15",
      "netlify-cdn-cache-control": "public, s-maxage=30, stale-while-revalidate=120"
    }
  });
};
