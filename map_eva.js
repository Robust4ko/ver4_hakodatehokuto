// map_eva.js （SVGアイコン全面表示 修正版）

/*
 1. コマンドプロンプトで、「E:」を入力
 2. パスの指定「cd "E:\2025年度\app_googlemap\map_simulation"」を入力実行
 3. サーバー開通「python -m http.server 8000」を入力実行
 4. ブラウザで「http://localhost:8000/index.html」を検索→完了 http://localhost:8000/map_hakodate/index.html
 5. コマンドプロンプトで、「コントロール＋C」でサーバー停止（コマンドプロンプトを閉じれば停止される）
*/

// ===== グローバル変数 =====
let map;
let directionsService;
let directionsRenderer;
let distanceMatrixService;
let startMarker = null;
let destinations = [];
let latestDestination = null;

// 追加：InfoWindow と 距離・時間の保持
let infoWindow = null;
let lastDistanceMeters = null;
let lastDurationText = null;

// ===== 共通UIメッセージ表示 =====
function displayMessage(message) {
  const el = document.getElementById("nearest-destination");
  if (el) el.textContent = message;
}

// ===== HTMLエスケープ（XSS簡易対策）=====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 地図初期化 =====
function initMap() {
  const center = { lat: 41.775271, lng: 140.7257441 };

  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 15,
    center: center,
    clickableIcons: false,
  });

  // 津波浸水想定域（GeoJSON）
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

  // 目的地データ読み込み
  loadDestinations();
  loadEvacPoints();

  // 地図クリックで出発地点を設定
  map.addListener("click", function (event) {
    setStartPoint(event.latLng);
  });
}

// ===== 目的地（避難ビル等）を読み込み（HB.svg） =====
function loadDestinations() {
  fetch("./destinations.json")
    .then((response) => response.json())
    .then((data) => {
      destinations = data;
      data.forEach((dest) => {
        // HB.svg を大きめに（当たり判定：34px）
        addCustomMarker(dest.location, dest.name, "./HB.svg", 34);
      });
    })
    .catch((error) => displayMessage("避難ビルの読み込みエラー: " + error));
}

// ===== 水平避難ポイントを読み込み（HP.svg、destinationsに統合）=====
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
        // HP.svg はやや小さめ（当たり判定：26px）
        addCustomMarker(structured.location, structured.name, "./HP.svg", 26);
      });
    })
    .catch((error) => displayMessage("水平避難ポイントの読み込みエラー: " + error));
}

// ===== マーカー生成（SVG画像、クリックで吹き出し表示）=====
// iconUrl: "./HB.svg" or "./HP.svg"
// sizePx: 表示サイズ（クリック当たり判定も同じ矩形）
function addCustomMarker(position, title, iconUrl, sizePx = 32) {
  const scaled = new google.maps.Size(sizePx, sizePx);
  const anchor = new google.maps.Point(sizePx / 2, sizePx / 2); // 中心を座標に合わせる
  const labelOrigin = new google.maps.Point(sizePx / 2, sizePx + 4);

  const marker = new google.maps.Marker({
    position: new google.maps.LatLng(position.lat, position.lng),
    map: map,
    title: title,
    zIndex: 10,
    icon: {
      url: iconUrl,
      // ▼ 重要：SVGが一部しか表示される問題を避けるために size は指定しない
      //   scaledSize のみ指定して、全体を縮小表示させる
      scaledSize: scaled,
      anchor: anchor,
      labelOrigin: labelOrigin,
      // originは既定(0,0)のままでOK（スプライトを使わないため）
    },
    optimized: false,  // SVGの切り取り/拡大縮小の不具合を避けるため canvas 描画に
  });

  marker.addListener("click", () => {
    openDestinationPopup({ name: title, location: position }, marker);
  });

  return marker;
}

// ===== 目的地ポップアップ（InfoWindow）=====
function openDestinationPopup(dest, marker) {
  latestDestination = dest;
  if (!infoWindow) infoWindow = new google.maps.InfoWindow();

  const linkId = "goto-" + Math.random().toString(36).slice(2);
  const html = `
    <div style="font-size:14px; line-height:1.5; background:#fff; color:#000; padding:2px 0;">
      <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(dest.name)}</div>
      <a id="${linkId}" href="#" style="color:#007bff; text-decoration:underline;">ここに行く</a>
    </div>
  `;

  infoWindow.setContent(html);
  infoWindow.open(map, marker);

  // InfoWindow内部のリンクにイベント付与
  google.maps.event.addListenerOnce(infoWindow, "domready", () => {
    const el = document.getElementById(linkId);
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (!startMarker) {
        displayMessage("出発地点が未設定です。地図をタップするか「現在地から避難」を押してください。");
        map.panTo(marker.getPosition());
        return;
      }
      const origin = startMarker.getPosition();
      drawRoute(origin, dest.location);
      // drawRoute 内で距離・時間つきのメッセージを出します
    });
  });
}

// ===== 出発地点の設定 =====
function setStartPoint(location) {
  if (startMarker) startMarker.setMap(null);
  startMarker = new google.maps.Marker({
    position: location,
    map: map,
    title: "スタート地点",
  });
  findClosestPoint(location);
}

// ===== 最近傍の避難先を探索（半径700m）=====
function findClosestPoint(origin) {
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

  const nearbyDestinations = destinations.filter((dest) => {
    const distance = getDistanceInMeters(
      { lat: origin.lat(), lng: origin.lng() },
      { lat: dest.location.lat, lng: dest.location.lng }
    );
    return distance <= 700;
  });

  if (nearbyDestinations.length === 0) {
    displayMessage("700m以内に避難場所がありません。");
    directionsRenderer.setDirections({ routes: [] });
    lastDistanceMeters = null;
    lastDurationText = null;
    latestDestination = null;
    return;
  }

  const destinationLocations = nearbyDestinations.map((dest) => dest.location);

  distanceMatrixService.getDistanceMatrix(
    {
      origins: [origin],
      destinations: destinationLocations,
      travelMode: google.maps.TravelMode.WALKING,
    },
    function (response, status) {
      if (status === google.maps.DistanceMatrixStatus.OK) {
        const distances = response.rows[0].elements;
        let closestIndex = 0;
        let minDistance = distances[0].distance.value;

        for (let i = 1; i < distances.length; i++) {
          if (distances[i].distance.value < minDistance) {
            minDistance = distances[i].distance.value;
            closestIndex = i;
          }
        }

        latestDestination = nearbyDestinations[closestIndex];

        // 距離・時間を保持し、表示もここで行う
        lastDistanceMeters = distances[closestIndex].distance.value;
        lastDurationText  = distances[closestIndex].duration.text;

        displayMessage(
          `${latestDestination.name}（${lastDistanceMeters} m、約 ${lastDurationText}）`
        );

        // 経路描画
        drawRoute(origin, latestDestination.location);
      } else {
        displayMessage("エラー: " + status);
      }
    }
  );
}

// ===== 経路描画（描画完了時の表示も距離・時間付きに統一）=====
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

        // 経路描画完了後のメッセージ
        if (latestDestination && lastDistanceMeters != null && lastDurationText != null) {
          displayMessage(`${latestDestination.name}（${lastDistanceMeters} m、約 ${lastDurationText}）`);
        } else if (latestDestination) {
          // 念のためのフォールバック
          displayMessage(`${latestDestination.name} へ経路を表示中…`);
        }
      } else {
        displayMessage("経路描画エラー: " + status);
      }
    }
  );
}

// ===== Googleマップ（別タブ）で開く =====
function openInGoogleMaps(origin, destination) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=walking`;
  window.open(url, "_blank");
}

function launchGoogleMap() {
  if (!startMarker || !latestDestination) {
    displayMessage("出発地点と目的地を設定してください。");
    return;
  }
  const origin = startMarker.getPosition();
  openInGoogleMaps(
    { lat: origin.lat(), lng: origin.lng() },
    latestDestination.location
  );
}

// ===== 現在地から避難 =====
function useCurrentLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function (position) {
        const latLng = new google.maps.LatLng(
          position.coords.latitude,
          position.coords.longitude
        );
        setStartPoint(latLng);
      },
      function (error) {
        displayMessage("現在地の取得に失敗しました: " + error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  } else {
    displayMessage("このブラウザは位置情報をサポートしていません。");
  }
}

// Google Maps の callback から参照できるように公開
window.initMap = initMap;
window.useCurrentLocation = useCurrentLocation;
window.launchGoogleMap = launchGoogleMap;
