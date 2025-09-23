// ver4.2：スマホ最適化
//  - 追加1: 「マーカー初回タップで、出発地点=そのマーカー位置として即ルート描画」
//  - 追加2: タッチ端末ではマーカー表示サイズ&当たり判定(circle shape)を少し小さく
// 既存: JA/ENトグル / 二段フッター / SVGアイコン / 欠け対策 / 700m→500mフォールバック ほか

/* ========== グローバル ========== */
let map;
let directionsService;
let directionsRenderer;
let distanceMatrixService;
let startMarker = null;
let destinations = [];   // { name, name_en?, location:{lat,lng} }
let latestDestination = null;

let infoWindow = null;
let lastDistanceMeters = null;
let lastDurationText = null;

const PRIMARY_RADIUS_M = 700;
const FALLBACK_RADIUS_M = 500;
const DESTINATION_LIMIT = 25;

/* ========== i18n ========== */
const I18N = {
  ja: {
    go_here: "ここに行く",
    need_start: "出発地点が未設定です。地図をタップするか「現在地から避難」を押してください。",
    rerun_fallback: "候補が多すぎるため、{radius}m で再検索します…",
    too_many_limit: "候補が非常に多いため、近い {limit} 件で評価します…",
    none_in_radius: "{radius}m以内に避難場所がありません。",
    route_error: "経路描画エラー: {status}",
    error_status: "エラー: {status}",
    nearest_fmt: "{name}（{meters} m、約 {duration}）",
    drawing_fmt: "{name} へ経路を表示中…",
    // UIラベル
    header_title: "津波避難シミュレーション",
    header_subtext: "📍 地図をクリックすると避難経路を表示します",
    info_title: "最短の避難先：",
    info_hint: "クリックして確認してください",
    btn_use_current: "現在地から避難",
    btn_open_gmaps: "Googleマップで開く"
  },
  en: {
    go_here: "Go here",
    need_start: "No start point set. Tap the map or press “Evacuate from current location”.",
    rerun_fallback: "Too many candidates. Retrying with {radius} m…",
    too_many_limit: "Too many candidates. Evaluating the nearest {limit} only…",
    none_in_radius: "No shelters within {radius} m.",
    route_error: "Route drawing error: {status}",
    error_status: "Error: {status}",
    nearest_fmt: "{name} ({meters} m, about {duration})",
    drawing_fmt: "Showing route to {name}…",
    // UI labels
    header_title: "Tsunami Evacuation Simulation",
    header_subtext: "📍 Click the map to show an evacuation route",
    info_title: "Nearest shelter:",
    info_hint: "Tap the map to start",
    btn_use_current: "Evacuate from current location",
    btn_open_gmaps: "Open in Google Maps"
  }
};

let LANG = (localStorage.getItem("lang") || ((navigator.language||"").startsWith("en") ? "en" : "ja"));
function setLanguage(lang) {
  LANG = (lang === "en") ? "en" : "ja";
  localStorage.setItem("lang", LANG);
  applyI18nToUI();
}
window.setLanguage = setLanguage;

function t(key, vars = {}) {
  const dict = I18N[LANG] || I18N.ja;
  let s = dict[key] || I18N.ja[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}
function fmtNum(n){ try { return new Intl.NumberFormat(LANG).format(n); } catch { return n; } }
function showNearestMessage(name, meters, durationText) {
  displayMessage(t("nearest_fmt", { name, meters: fmtNum(meters), duration: durationText }));
}
function applyI18nToUI(){
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    const txt = t(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.setAttribute("placeholder", txt);
    } else {
      el.textContent = txt;
    }
  });
  const btn = document.getElementById("lang-toggle");
  if (btn){
    btn.textContent = (LANG === "ja" ? "EN" : "日");
    btn.setAttribute("aria-label", LANG === "ja" ? "Switch to English" : "日本語に切り替え");
  }
}

/* ========== Utils ========== */
function displayMessage(message) {
  const el = document.getElementById("nearest-destination");
  if (el) el.textContent = message;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDistanceInMeters(loc1, loc2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(loc2.lat - loc1.lat);
  const dLng = toRad(loc2.lng - loc1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(loc1.lat)) *
      Math.cos(toRad(loc2.lat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function collectCandidates(originLatLng, radiusMeters, sortByStraightDist = true) {
  const origin = { lat: originLatLng.lat(), lng: originLatLng.lng() };
  const withDist = destinations
    .map((dest) => {
      const d = getDistanceInMeters(origin, dest.location);
      return { ...dest, __straightDist: d };
    })
    .filter((x) => x.__straightDist <= radiusMeters);

  if (sortByStraightDist) {
    withDist.sort((a, b) => a.__straightDist - b.__straightDist);
  }
  return withDist;
}

// 表示名（LANGに応じてname / name_en）
function getDisplayNameFor(dest) {
  if (!dest) return "";
  const name = dest.name || "";
  const name_en = dest.name_en || name; // json未対応時は name を流用
  return (LANG === "en") ? (name_en || name) : name;
}

/* ========== 地図初期化 ========== */
function initMap() {
  const center = { lat: 41.775271, lng: 140.7257441 };

  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 15,
    center: center,
    clickableIcons: false,
  });

  // 初期i18n & トグル
  applyI18nToUI();
  const langBtn = document.getElementById("lang-toggle");
  if (langBtn){
    langBtn.addEventListener("click", () => {
      setLanguage(LANG === "ja" ? "en" : "ja");
      if (latestDestination && lastDistanceMeters != null && lastDurationText != null) {
        showNearestMessage(getDisplayNameFor(latestDestination), lastDistanceMeters, lastDurationText);
      }
    });
  }

  // 津波浸水想定域（GeoJSON）
  map.data.loadGeoJson("./tsunami.geojson");
  map.data.setStyle({
    fillColor: "#5c9ee7",
    fillOpacity: 0.3,
    strokeColor: "#5c9ee7",
    strokeWeight: 1,
    clickable: false,
  });

  // 経路系サービス
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer();
  directionsRenderer.setMap(map);

  // 距離行列
  distanceMatrixService = new google.maps.DistanceMatrixService();

  // データ読み込み
  loadDestinations();
  loadEvacPoints();

  // 地図クリック → 出発地点セット
  map.addListener("click", (event) => {
    setStartPoint(event.latLng);
  });
}

/* ========== データ読み込み ========== */
function loadDestinations() {
  fetch("./destinations.json")
    .then((r) => r.json())
    .then((data) => {
      destinations = data.map(d => ({
        ...d,
        name_en: d.name_en ?? d.name   // 将来移行のために同値で補完
      }));
      destinations.forEach((dest) => {
        addCustomMarker(dest.location, getDisplayNameFor(dest), "building");
      });
    })
    .catch((error) => displayMessage("避難ビルの読み込みエラー: " + error));
}

function loadEvacPoints() {
  fetch("./evac_points.json")
    .then((r) => r.json())
    .then((data) => {
      data.forEach((point) => {
        const structured = {
          name: point.name,
          name_en: point.name_en ?? point.name,  // 同値で補完
          location: {
            lat: point.location?.lat ?? point.lat,
            lng: point.location?.lng ?? point.lng,
          },
        };
        destinations.push(structured);
        addCustomMarker(structured.location, getDisplayNameFor(structured), "point");
      });
    })
    .catch((error) => displayMessage("水平避難ポイントの読み込みエラー: " + error));
}

/* ========== マーカー（SVG） ========== */
// 欠け対策：size=原寸, scaledSize=表示サイズ, optimized:false
// 当たり判定：タッチ端末では少し小さめ。shape は円領域。anchor は足元（下辺中央）。
function addCustomMarker(position, title, type = "building") {
  const iconUrl = (type === "point") ? "./HP.svg" : "./HB.svg";

  const BASE = 606; // SVG viewBox ≒ 605.67
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  // ★タッチ端末で少し小さめに（当たり判定も連動で縮小）
  const sizeByType = isTouch ? { building: 28, point: 16 } : { building: 34, point: 20 };
  const w = sizeByType[type] || (isTouch ? 26 : 30);
  const h = w;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r  = Math.max(4, Math.floor(w / 2) - (isTouch ? 4 : 2));

  const marker = new google.maps.Marker({
    position: new google.maps.LatLng(position.lat, position.lng),
    map: map,
    title: title,
    clickable: true,
    icon: {
      url: iconUrl,
      size: new google.maps.Size(BASE, BASE),
      scaledSize: new google.maps.Size(w, h),
      origin: new google.maps.Point(0, 0),
      anchor: new google.maps.Point(cx, h - 2)   // 足元
    },
    shape: { type: "circle", coords: [cx, cy, r] },
    optimized: false
  });

  marker.addListener("click", () => {
    // 登録済みデータを同一座標で拾う（見つからない場合は即席オブジェクト）
    const dest =
      destinations.find(d =>
        Math.abs(d.location.lat - position.lat) < 1e-9 &&
        Math.abs(d.location.lng - position.lng) < 1e-9
      ) || { name: title, name_en: title, location: position };

    // ★追加1: 出発地点が未設定なら、このタップで出発地点=マーカー位置＆即ルート
    if (!startMarker) {
      setStartPoint(marker.getPosition());
      latestDestination = dest;
      drawRoute(startMarker.getPosition(), dest.location);
      return; // ここではポップアップを開かない（もうルートが出るため）
    }

    // 出発地点がある場合は従来どおりポップアップ
    openDestinationPopup(dest, marker);
  });

  return marker;
}

/* ========== ポップアップ（InfoWindow） ========== */
// 矢印先端＝足元（marker.getPosition()）に一致。
// アイコン高さから pixelOffset を自動計算（lift）
function openDestinationPopup(dest, marker) {
  latestDestination = dest;

  // 可変オフセット（lift）の計算
  let lift = 20;
  try {
    const icon = marker.getIcon && marker.getIcon();
    const h = (icon && icon.scaledSize && Number(icon.scaledSize.height)) || 0;
    if (h > 0) {
      lift = Math.round(Math.min(30, Math.max(18, h * 0.8)));
    }
  } catch (_) {}

  const linkId = "goto-" + Math.random().toString(36).slice(2);
  const displayName = getDisplayNameFor(dest);
  const html = `
    <div style="font-size:14px; line-height:1.5; background:#fff; color:#000; padding:2px 0;">
      <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(displayName)}</div>
      <a id="${linkId}" href="#" style="color:#007bff; text-decoration:underline;">${t("go_here")}</a>
    </div>
  `;

  if (!infoWindow) {
    infoWindow = new google.maps.InfoWindow({
      maxWidth: 260,
      pixelOffset: new google.maps.Size(0, -lift)
    });
  } else {
    infoWindow.setOptions({
      maxWidth: 260,
      pixelOffset: new google.maps.Size(0, -lift)
    });
  }

  infoWindow.setContent(html);
  infoWindow.setPosition(marker.getPosition()); // 足元に一致
  infoWindow.open(map);

  google.maps.event.addListenerOnce(infoWindow, "domready", () => {
    const el = document.getElementById(linkId);
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (!startMarker) {
        // （保険）ここに来るのは通常2回目タップ以降だが、未設定時は案内
        displayMessage(t("need_start"));
        map.panTo(marker.getPosition());
        return;
      }
      const origin = startMarker.getPosition();
      drawRoute(origin, dest.location);
    });
  });
}

/* ========== 出発地点 & 探索 ========== */
function setStartPoint(location) {
  if (startMarker) startMarker.setMap(null);
  startMarker = new google.maps.Marker({
    position: location,
    map: map,
    title: "Start",
  });
  findClosestPoint(location);
}

function findClosestPoint(originLatLng) {
  attemptWithRadius(originLatLng, PRIMARY_RADIUS_M, /*isFallback*/ false);
}

function attemptWithRadius(originLatLng, radiusMeters, isFallback) {
  const origin = originLatLng;
  const nearby = collectCandidates(origin, radiusMeters, /*sort*/ true);

  if (nearby.length === 0) {
    displayMessage(t("none_in_radius", { radius: radiusMeters }));
    directionsRenderer.setDirections({ routes: [] });
    lastDistanceMeters = null;
    lastDurationText = null;
    latestDestination = null;
    return;
  }

  if (nearby.length > DESTINATION_LIMIT) {
    if (!isFallback) {
      displayMessage(t("rerun_fallback", { radius: FALLBACK_RADIUS_M }));
      attemptWithRadius(origin, FALLBACK_RADIUS_M, /*isFallback*/ true);
      return;
    } else {
      displayMessage(t("too_many_limit", { limit: DESTINATION_LIMIT }));
    }
  }

  const candidates = (nearby.length > DESTINATION_LIMIT && isFallback)
    ? nearby.slice(0, DESTINATION_LIMIT)
    : nearby;

  const destinationLocations = candidates.map(d => d.location);

  distanceMatrixService.getDistanceMatrix(
    {
      origins: [origin],
      destinations: destinationLocations,
      travelMode: google.maps.TravelMode.WALKING,
    },
    (response, status) => {
      const statusStr = String(status);
      const isMaxErr =
        statusStr === "MAX_DIMENSIONS_EXCEEDED" ||
        statusStr === "MAX_ELEMENTS_EXCEEDED" ||
        status === google.maps.DistanceMatrixStatus.MAX_ELEMENTS_EXCEEDED ||
        status === google.maps.DistanceMatrixStatus.MAX_DIMENSIONS_EXCEEDED;

      if (isMaxErr && !isFallback) {
        displayMessage(t("rerun_fallback", { radius: FALLBACK_RADIUS_M }));
        attemptWithRadius(origin, FALLBACK_RADIUS_M, /*isFallback*/ true);
        return;
      }

      if (status === google.maps.DistanceMatrixStatus.OK) {
        const distances = response.rows[0].elements;

        let closestIndex = 0;
        let minDistance = distances[0].distance.value;
        for (let i = 1; i < distances.length; i++) {
          if (distances[i].status === "OK" && distances[i].distance.value < minDistance) {
            minDistance = distances[i].distance.value;
            closestIndex = i;
          }
        }

        latestDestination = candidates[closestIndex];
        lastDistanceMeters = distances[closestIndex].distance.value;
        lastDurationText  = distances[closestIndex].duration.text;

        showNearestMessage(getDisplayNameFor(latestDestination), lastDistanceMeters, lastDurationText);
        drawRoute(origin, latestDestination.location);
      } else {
        displayMessage(t("error_status", { status: statusStr }));
      }
    }
  );
}

/* ========== 経路描画 ========== */
function drawRoute(origin, destination) {
  directionsService.route(
    {
      origin: origin,
      destination: destination,
      travelMode: google.maps.TravelMode.WALKING,
    },
    (result, status) => {
      if (status === google.maps.DirectionsStatus.OK) {
        directionsRenderer.setDirections(result);
        if (latestDestination && lastDistanceMeters != null && lastDurationText != null) {
          showNearestMessage(getDisplayNameFor(latestDestination), lastDistanceMeters, lastDurationText);
        } else if (latestDestination) {
          displayMessage(t("drawing_fmt", { name: getDisplayNameFor(latestDestination) }));
        }
      } else {
        displayMessage(t("route_error", { status }));
      }
    }
  );
}

/* ========== 外部起動 / 現在地 ========== */
function openInGoogleMaps(origin, destination) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=walking`;
  window.open(url, "_blank");
}

function launchGoogleMap() {
  if (!startMarker || !latestDestination) {
    displayMessage(t("need_start"));
    return;
  }
  const origin = startMarker.getPosition();
  openInGoogleMaps(
    { lat: origin.lat(), lng: origin.lng() },
    latestDestination.location
  );
}

function useCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = new google.maps.LatLng(
          position.coords.latitude,
          position.coords.longitude
        );
        setStartPoint(latLng);
      },
      (error) => {
        displayMessage("Geolocation error: " + error.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } else {
    displayMessage("This browser does not support Geolocation.");
  }
}

/* ========== 公開 ========== */
window.initMap = initMap;
window.useCurrentLocation = useCurrentLocation;
window.launchGoogleMap = launchGoogleMap;

