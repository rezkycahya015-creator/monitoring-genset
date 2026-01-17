// --- FUNGSI NAVIGASI HALAMAN ---
function showPage(pageId) {
  // Sembunyikan semua halaman
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  // Tampilkan halaman yang dipilih
  document.getElementById(pageId).classList.add("active");

  // Update status tombol navigasi
  document
    .querySelectorAll(".nav-item")
    .forEach((btn) => btn.classList.remove("active"));
  if (pageId === "dashboard")
    document.getElementById("btn-dashboard").classList.add("active");
  if (pageId === "riwayat")
    document.getElementById("btn-riwayat").classList.add("active");
}

// --- CONFIG FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyD4edL-s3i0Sffk7es00Gm1AUv8Y7Oorgw",
  authDomain: "iot-project-93719.firebaseapp.com",
  databaseURL:
    "https://iot-project-93719-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "iot-project-93719",
  storageBucket: "iot-project-93719.firebasestorage.app",
  messagingSenderId: "579950021426",
  appId: "1:579950021426:web:cd47cf9aaa60eab8b7252b",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- LOGIC UI DASHBOARD ---
const batteryFill = document.getElementById("battery-fill");
const percVal = document.getElementById("perc-val");
const statusText = document.getElementById("status-text");
const alertBar = document.getElementById("alert-bar");
const alertPerc = document.getElementById("alert-perc");
const pTinggi = document.getElementById("p-tinggi");
const pVolume = document.getElementById("p-volume");
const pEstimasi = document.getElementById("p-estimasi");

function updateUI(volume) {
  const maxVolume = 440;
  let percentage = Math.round((volume / maxVolume) * 100);
  if (percentage > 100) percentage = 100;

  percVal.innerText = percentage + "%";
  pVolume.innerText = volume.toFixed(1) + " L";

  // Hitung Estimasi (85 Liter/Jam)
  const hours = volume / 85;
  // Konversi ke Jam & Menit
  const jam = Math.floor(hours);
  const menit = Math.round((hours - jam) * 60);
  pEstimasi.innerText = `± ${jam} Jam ${menit} Menit`;

  batteryFill.style.height = `calc(${percentage}% - 10px)`;

  let color = "";
  let status = "";

  if (percentage >= 80) {
    color = "#2ecc71";
    status = "Sangat Aman";
    alertBar.style.display = "none";
  } else if (percentage >= 60) {
    color = "#f1c40f";
    status = "Cukup";
    alertBar.style.display = "none";
  } else if (percentage >= 40) {
    color = "#e67e22";
    status = "Waspada";
    alertBar.style.display = "none";
  } else {
    color = "#e74c3c";
    status = "Bahaya";  
    alertBar.style.display = "flex";
    alertPerc.innerText = percentage;
  }

  batteryFill.style.backgroundColor = color;
  percVal.style.color = color;
  statusText.innerText = status;
  statusText.style.color = color;
}

db.ref("/genset/volume").on("value", (snapshot) => {
  const val = snapshot.val();
  if (val !== null) updateUI(val);
});

db.ref("/genset/tinggi").on("value", (snapshot) => {
  const val = snapshot.val();
  if (val !== null) pTinggi.innerText = val + " CM";
});

// --- LOGIKA REAL-TIME LOGS ---
const logTableBody = document.getElementById("log-table-body");

db.ref("/genset/last_run").on("value", (snapshot) => {
  const data = snapshot.val();

  // Jika tidak ada data atau data dummy default
  if (!data || !data.tanggal) {
    if (logTableBody.children.length === 0 || logTableBody.innerHTML.includes("Memuat")) {
      logTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Menunggu data aktivitas...</td></tr>`;
    }
    return;
  }

  // Bersihkan "Memuat data..." jika ada
  if (logTableBody.innerHTML.includes("Memuat")) {
    logTableBody.innerHTML = "";
  }

  // --- 1. SIAPKAN DATA ---
  // Parse Tanggal & Jam (Format di DB: "DD/MM/YYYY HH:mm")
  let datePart = "Unknown";
  let timePart = "Unknown";

  if (data.tanggal) {
    const parts = data.tanggal.split(" ");
    if (parts.length >= 2) {
      datePart = parts[0];
      timePart = parts[1];
    }
  }

  // Hitung Perubahan Volume
  let volAwal = parseFloat(data.volume_awal || 0);
  let volAkhir = parseFloat(data.volume_akhir || 0);
  let diff = volAkhir - volAwal;

  // Tentukan Style & Label
  let volumeText = "";
  let volumeStyle = "";
  let activityBadge = "";

  if (diff >= 0) {
    // Pengisian (atau 0)
    volumeText = "+ " + diff.toFixed(1) + " L";
    volumeStyle = "color: #2e7d32; font-weight: 600;";
    activityBadge = `<span class="status-badge badge-fill"><i class="fa-solid fa-gas-pump"></i> Pengisian</span>`;
  } else {
    // Pemakaian
    volumeText = "- " + Math.abs(diff).toFixed(1) + " L";
    volumeStyle = "color: #e67e22; font-weight: 600;";
    activityBadge = `<span class="status-badge badge-drain"><i class="fa-solid fa-arrow-trend-down"></i> Pemakaian</span>`;
  }

  // --- 2. LOGIKA UPDATE VS INSERT ---
  // Kita gunakan 'tanggal' sebagai ID unik sederhana.
  // Jika tanggal sama dengan baris paling atas, kita UPDATE baris itu.
  // Jika beda, kita INSERT baris baru di atas.

  // Hapus karakter non-alphanumeric untuk jadi ID valid HTML
  const rowId = "row-" + data.tanggal.replace(/[^a-zA-Z0-9]/g, "");
  const existingRow = document.getElementById(rowId);

  const rowContent = `
        <td>${datePart}</td>
        <td>${timePart}</td>
        <td style="${volumeStyle}">${volumeText}</td>
        <td>${activityBadge}</td>
        <td>${data.status || "Normal"}</td>
  `;

  if (existingRow) {
    // Update baris yang sudah ada
    existingRow.innerHTML = rowContent;
  } else {
    // Data Baru -> Tambah Row Baru
    const newRow = document.createElement("tr");
    newRow.id = rowId;
    newRow.innerHTML = rowContent;
    newRow.classList.add("fade-in"); // Optional animation class if existing

    // Prepend (Taruh paling atas)
    logTableBody.insertBefore(newRow, logTableBody.firstChild);

    // Batasi jumlah baris
    if (logTableBody.children.length > 10) {
      logTableBody.removeChild(logTableBody.lastChild);
    }
  }
});
