// map_eva.js （SVGアイコン + 多言語 + DistanceMatrix フォールバック）

/*
 1. コマンドプロンプトで、「E:\」を入力
 2. cd "E:\2025年度\app_googlemap\map_simulation"
 3. python -m http.server 8000
 4. http://localhost:8000/index.html
 5. 停止は Ctrl+C
*/

// ===== 多言語メッセージ辞書（UIは index.html 側、運用メッセージはここ）=====
let APP_LANG = "ja";
const MSG = {
  ja: {
    noNearby: "700m以内に避難場所がありません。",
    noStartSet: "出発地点が未設定です。地図をタップするか「現在地から避難」を押してください。",
    routeDrawing: "経路を表示中…",
    errorPrefix: "エラー: ",
    dirErrorPrefix: "経路描画エラー: ",
    geolocFail: (m)=>`現在地の取得に失敗しました: ${m}`,
    browserNoGeo: "このブラウザは位置情報をサポートしていません。",
    needStartAndDest: "出発地点と目的地を設定してください。",
    narrowedTo500: "候補が多いため、500m以内に絞って探索しました。",
    usingTop25: "候補が多いため、近い25件に絞って探索しました。"
  },
  en: {
    noNearby: "No shelters within 700 m.",
    noStartSet: "No start point set. Tap the map or press 'Evacuate from current location'.",
    routeDrawing: "Drawing route…",
    errorPrefix: "Error: ",
    dirErrorPrefix: "Directions error: ",
    geolocFail: (m)=>`Failed to get your location: ${m}`,
    browserNoGeo: "This browser does not support geolocation.",
    needStartAndDest: "Please set both a start point and a destination.",
    narrowedTo500: "Too many candidates. Narrowed down to within 500 m.",
    usingTop25: "Too many candidates. Using the nearest 25."
  }
};
function T(key){
  const dict = MSG[APP_LANG] || MSG.ja;
  return typeof dict[key] === "function" ? dict[key] : dict[key] || key;
}

// ===== グローバル =====
let map;
let directionsService;
let directionsRenderer;
let distanceMatrixService;
let startMarker = null;
let destinations = [];
let latestDestination = null;
let dataReady = { hb: false, hp: false };
function ready(){ return dataReady.hb && dataReady.hp; }


// 追加：InfoWindow と 距離・時間の保持
let infoWindow = null;
let lastDistanceMeters = null;
let lastDurationText = null;

// ===== 共通UIメッセージ表示 =====
function displayMessage(message) {
  const el = document.getElementById("nearest-destination")
  if (el) el.textContent = message;
}

// ===== Google Map 初期化 =====
function initMap() {
  // 言語（index.html から受ける場合は URL パラメータ等で上書き可）
  try {
    const params = new URLSearchParams(window.location.search);
    const lang = params.get("lang");
    if (lang) APP_LANG = lang;
  } catch (_) {}

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 41.775, lng: 140.726 },
    zoom: 16,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
    clickableIcons: false,
    gestureHandling: "greedy",
  });

  // 海水浸水（tsunami.geojson）描画
  map.data.loadGeoJson("./tsunami.geojson");
  map.data.setStyle({
    fillColor: "#5c9ee7",
    fillOpacity: 0.3,
    strokeColor: "#5c9ee7",
    strokeWeight: 1,
    clickable: false,
  });

  // 経路系サービス初期化
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer();
  directionsRenderer.setMap(map);

  // 距離行列サービス
  distanceMatrixService = new google.maps.DistanceMatrixService();

  // マーカー群ロード
  loadDestinations();
  loadEvacPoints();

  // 地図クリックで出発地点を設定
  map.addListener("click", function (event) {
    setStartPoint(event.latLng);
  });
}

// ===== 目的地（避難ビル等）HB.svg =====
function loadDestinations() {
  fetch("./destinations.json")
    .then((response) => response.json())
    .then((data) => {
      destinations.push(...data);
      dataReady.hb = true;
      data.forEach((dest) => {
        addCustomMarker(dest.location, dest.name, "./HB.svg", 34);
      });
    })
    .catch((error) => displayMessage((T('errorPrefix')) + error));
}

// ===== 水平避難ポイント HP.svg（destinationsに統合）=====
function loadEvacPoints() {
  fetch("./evac_points.json")
    .then((response) => response.json())
    .then((data) => {
      data.forEach((point) => {
        const structured = {
          name: point.name,
          location: {
            lat: point.location?.lat ?? point.lat,
            lng: point.location?.lng ?? point.lng,
          },
        };
        destinations.push(structured);
        addCustomMarker(structured.location, structured.name, "./HP.svg", 26);
      });
      dataReady.hp = true;
    })
    .catch((error) => displayMessage((T('errorPrefix')) + error)
);
}

// ===== マーカー生成（SVG画像表示フル）=====
function addCustomMarker(position, title, iconUrl, sizePx = 32) {
  const scaled = new google.maps.Size(sizePx, sizePx);
  const anchor = new google.maps.Point(sizePx / 2, sizePx / 2);
  const labelOrigin = new google.maps.Point(sizePx / 2, sizePx + 4);

  const marker = new google.maps.Marker({
    position: new google.maps.LatLng(position.lat, position.lng),
    map: map,
    title: title,
    zIndex: 10,
    icon: {
      url: iconUrl,
      scaledSize: scaled,
      anchor: anchor,
      labelOrigin: labelOrigin,
    },
  });

  // タップ領域を少し広げるために InfoWindow を使う
  marker.addListener("click", () => {
    // ラベルをちょい上げ（アイコンサイズに応じて可変）
    let lift = 10;
    try {
      const icon = marker.getIcon && marker.getIcon();
      const h = (icon && icon.scaledSize && Number(icon.scaledSize.height)) || 0;
      if (h > 0) {
        lift = Math.round(Math.min(18, Math.max(6, h * 0.35)));
      }
    } catch (_) {}

    if (!infoWindow) infoWindow = new google.maps.InfoWindow();
    infoWindow.setContent(`<div style="font-size:14px;line-height:1.4">${title}</div>`);
    infoWindow.setPosition({ lat: position.lat + (lift * 1e-5), lng: position.lng });
    infoWindow.open({ map });

    // ポイントを目的地として扱い、出発地点未設定ならガイド
    const msg = (APP_LANG === "ja")
      ? `${title} を目的地候補として選択できます。地図をタップして出発地点を設定してください。`
      : `You can select ${title} as a candidate. Tap the map to set your start point.`;
    displayMessage(msg);
  });

  return marker;
}

// ===== Haversine 距離（メートル）=====
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ===== 出発地点の設定 =====
function setStartPoint(location) {
  if (!ready()) { displayMessage("データ読み込み中…"); return; }
  if (startMarker) startMarker.setMap(null);
  startMarker = new google.maps.Marker({
    position: location,
    map: map,
    title: (APP_LANG === "ja") ? "スタート地点" : "Start point",
  });
  findClosestPoint(location);
}

// ===== 近傍抽出 & フォールバック選定 =====
function selectDestinationsForMatrix(originLatLng) {
  // 700m 圏
  const origin = { lat: originLatLng.lat(), lng: originLatLng.lng() };
  const withinRadius = (arr, radius) =>
    arr.filter((d) => haversineMeters(origin, d.location) <= radius);

  const in700 = withinRadius(destinations, 700);

  if (in700.length === 0) {
    return { list: [], note: null };
  }

  if (in700.length <= 25) {
    return { list: in700, note: null };
  }

  // 25超え → 500m に再絞り
  const in500 = withinRadius(destinations, 500);

  if (in500.length === 0) {
    // 500m に存在しない場合は、700m から近い順 25 件
    const top25 = in700
      .map(d => ({ d, dist: haversineMeters(origin, d.location) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 25)
      .map(x => x.d);
    return { list: top25, note: "usingTop25" };
  }

  if (in500.length <= 25) {
    return { list: in500, note: "narrowedTo500" };
  }

  // 500m でも 25 超 → 近い順 25 件
  const top25in500 = in500
    .map(d => ({ d, dist: haversineMeters(origin, d.location) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 25)
    .map(x => x.d);

  return { list: top25in500, note: "usingTop25" };
}

// ===== 最近傍の避難先を探索（Distance Matrix に渡す候補を選ぶ）=====
function findClosestPoint(originLatLng) {
  const origin = originLatLng;
  const selection = selectDestinationsForMatrix(origin);

  if (selection.list.length === 0) {
    displayMessage(T('noNearby'));
    directionsRenderer.setDirections({ routes: [] });
    lastDistanceMeters = null;
    lastDurationText = null;
    latestDestination = null;
    return;
  }

  // 必要なら注記メッセージ（UIに軽く表示）
  if (selection.note) {
    console.log(selection.note === "narrowedTo500" ? T('narrowedTo500') : T('usingTop25'));
  }

  const destinationLocations = selection.list.map((dest) => dest.location);

  // DistanceMatrix で実距離を取得
  distanceMatrixService.getDistanceMatrix(
    {
      origins: [origin],
      destinations: destinationLocations,
      travelMode: google.maps.TravelMode.WALKING,
      unitSystem: google.maps.UnitSystem.METRIC,
    },
    function (response, status) {
      if (status !== "OK" || !response || !response.rows || !response.rows[0]) {
        // フォールバック：直線距離で最短
        let minDist = Infinity;
        let minDest = null;
        const originLatLngPlain = { lat: origin.lat(), lng: origin.lng() };
        selection.list.forEach((dest) => {
          const d = haversineMeters(originLatLngPlain, dest.location);
          if (d < minDist) {
            minDist = d;
            minDest = dest;
          }
        });
        latestDestination = minDest;
        lastDistanceMeters = Math.round(minDist);
        lastDurationText = null;
        if (minDest) drawRoute(origin, minDest.location);
        return;
      }

      const elements = response.rows[0].elements;
      let minDuration = Infinity;
      let minIndex = -1;
      elements.forEach((elem, idx) => {
        if (elem.status === "OK") {
          const durationValue = elem.duration.value; // 秒
          if (durationValue < minDuration) {
            minDuration = durationValue;
            minIndex = idx;
          }
        }
      });

      if (minIndex === -1) {
        displayMessage(T('noNearby'));
        latestDestination = null;
        return;
      }

      latestDestination = selection.list[minIndex];
      // 表示用に距離と時間を保存
      const elem = elements[minIndex];
      lastDistanceMeters = elem.distance ? elem.distance.value : null;
      lastDurationText = elem.duration ? elem.duration.text : null;

      drawRoute(origin, latestDestination.location);
    }
  );
}

// ===== Google ルートプレビュー（別タブで開く）=====
function launchGoogleMap() {
  if (!startMarker || !latestDestination) {
    displayMessage(T('needStartAndDest'));
    return;
  }
  const s = startMarker.getPosition();
  const d = latestDestination.location;
  const sParam = `${s.lat()},${s.lng()}`;
  const dParam = `${d.lat ?? d.lat}${d.lng ? ',' + d.lng : ',' + d.lng}`;
  const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(sParam)}&destination=${encodeURIComponent(`${d.lat},${d.lng}`)}&travelmode=walking`;
  window.open(url, "_blank");
}

// ===== 経路描画 =====
function drawRoute(origin, destination) {
  directionsService.route(
    {
      origin: origin,
      destination: destination,
      travelMode: google.maps.TravelMode.WALKING,
    },
    function (result, status) {
      if (status === google.maps.DirectionsStatus.OK) {
        directionsRenderer.setDirections(result);
        if (latestDestination && lastDistanceMeters != null && lastDurationText != null) {
          const summary = (APP_LANG === "ja")
            ? `${latestDestination.name}（${lastDistanceMeters} m、約 ${lastDurationText}）`
            : `${latestDestination.name} (${lastDistanceMeters} m, about ${lastDurationText})`;
          displayMessage(summary);
        } else if (latestDestination) {
          const msg = (APP_LANG === "ja")
            ? `${最新Destination.name} ${T('routeDrawing')}`
            : `${latestDestination.name}${T('routeDrawing')}`;
          displayMessage(msg);
        }
      } else {
        displayMessage(T('dirErrorPrefix') + status);
      }
    }
  );
}

// ===== 現在地から避難 =====
function useCurrentLocation() {
  if (!navigator.geolocation) {
    displayMessage(T('browserNoGeo'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      map.setCenter(coords);
      setStartPoint(new google.maps.LatLng(coords.lat, coords.lng));
    },
    (err) => {
      displayMessage(T('geolocFail')(err.message || err.code));
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

// Google Maps の callback から参照できるように公開
window.initMap = initMap;
window.useCurrentLocation = useCurrentLocation;
window.launchGoogleMap = launchGoogleMap;
