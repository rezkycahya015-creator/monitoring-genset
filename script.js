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

// --- LOGIKA REAL-TIME & HISTORY ---

// State Global untuk Data
let operationalHistoryData = [];
let fuelLogData = [];

const logTableBody = document.getElementById("log-table-body");
const riwayatTableBody = document.getElementById("riwayat-table-body");

const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const btnFilter = document.getElementById("btn-filter");

const btnExportRiwayat = document.getElementById("btn-export-riwayat");
const btnExportLogs = document.getElementById("btn-export-logs");

// 1. DATA RIWAYAT OPERASIONAL (Fetch from /genset/history)
db.ref("/genset/history").on("value", (snapshot) => {
  const data = snapshot.val();
  operationalHistoryData = []; // Reset

  if (data) {
    // Convert Object to Array
    Object.keys(data).forEach((key) => {
      operationalHistoryData.push({
        id: key,
        ...data[key],
      });
    });

    // Urutkan berdasarkan tanggal descending (terbaru diatas)
    // Asumsi format tanggal di DB bisa diparsing atau string ISO. 
    // Jika format DD/MM/YYYY, kita perlu parse manual untuk sorting.
    // Disini saya pakai simple reverse jika data masuk berurutan, atau sort by key.
    operationalHistoryData.reverse();
  }

  renderRiwayat(operationalHistoryData);
});

// Render Fungsi Riwayat
function renderRiwayat(data) {
  riwayatTableBody.innerHTML = "";

  if (data.length === 0) {
    riwayatTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Tidak ada data.</td></tr>`;
    return;
  }

  data.forEach((item) => {
    const row = `
      <tr>
        <td>${item.tanggal || "-"}</td>
        <td>${item.jam_nyala || "-"}</td>
        <td>${item.durasi || "-"}</td>
        <td>${item.konsumsi_bbm || "-"}</td>
        <td><span class="status-badge">${item.status || "Normal"}</span></td>
      </tr>
    `;
    riwayatTableBody.innerHTML += row;
  });
}


// 2. DATA LOG PERUBAHAN BAHAN BAKAR (Real-time Accumulation)
// Karena /genset/last_run hanya mengirim data SATU log terakhir,
// Kita simpan di array lokal sesi ini.
// IDEALNYA: Ada path /genset/fuel_logs yang menyimpan semua history log.
// Namun sesuai request "dibuat responsif dan update setiap ada perubahan",
// saya akan tetap listen last_run dan append ke array local.

db.ref("/genset/last_run").on("value", (snapshot) => {
  const data = snapshot.val();
  if (!data || !data.tanggal) return; // Skip empty

  // Cek duplicate biar gak double kalau ada refresh/init value
  const exists = fuelLogData.find(d => d.tanggal === data.tanggal);
  // Note: menggunakan 'tanggal' sebagai unique ID agak riskan kalau string sama persis, 
  // tapi cukup untuk usecase sederhana.

  if (!exists) {
    // Add to beginning
    fuelLogData.unshift(data);

    // Perbarui Tampilan (jika tidak sedang difilter/mode default)
    // Atau trigger filter ulang jika sedang ada filter aktif?
    // Simplified: Render ulang semua (atau filtered)
    applyFilter();
  }
});

function renderLogs(data) {
  logTableBody.innerHTML = "";

  if (data.length === 0) {
    logTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Belum ada data log baru.</td></tr>`;
    return;
  }

  data.forEach((item) => {
    // Parse Tanggal & Jam
    let datePart = "-";
    let timePart = "-";
    if (item.tanggal) {
      const parts = item.tanggal.split(" ");
      if (parts.length >= 2) {
        datePart = parts[0];
        timePart = parts[1];
      } else {
        datePart = item.tanggal;
      }
    }

    // Hitung Perubahan
    let volAwal = parseFloat(item.volume_awal || 0);
    let volAkhir = parseFloat(item.volume_akhir || 0);
    let diff = volAkhir - volAwal;

    let volumeText = "";
    let volumeStyle = "";
    let activityBadge = "";

    if (diff >= 0) {
      volumeText = "+ " + diff.toFixed(1) + " L";
      volumeStyle = "color: #2e7d32; font-weight: 600;";
      activityBadge = `<span class="status-badge badge-fill"><i class="fa-solid fa-gas-pump"></i> Pengisian</span>`;
    } else {
      volumeText = "- " + Math.abs(diff).toFixed(1) + " L";
      volumeStyle = "color: #e67e22; font-weight: 600;";
      activityBadge = `<span class="status-badge badge-drain"><i class="fa-solid fa-arrow-trend-down"></i> Pemakaian</span>`;
    }

    const row = `
        <tr>
            <td>${datePart}</td>
            <td>${timePart}</td>
            <td style="${volumeStyle}">${volumeText}</td>
            <td>${activityBadge}</td>
            <td>${item.status || "Normal"}</td>
        </tr>
      `;
    logTableBody.innerHTML += row;
  });
}


// --- 3. FITUR FILTER TANGGAL ---
btnFilter.addEventListener("click", applyFilter);

function applyFilter() {
  const startVal = startDateInput.value; // YYYY-MM-DD
  const endVal = endDateInput.value;     // YYYY-MM-DD

  // Filter Data Riwayat
  const filteredRiwayat = filterDataByDate(operationalHistoryData, startVal, endVal);
  renderRiwayat(filteredRiwayat);

  // Filter Data Logs
  const filteredLogs = filterDataByDate(fuelLogData, startVal, endVal);
  renderLogs(filteredLogs);
}

function filterDataByDate(dataArray, startDateStr, endDateStr) {
  if (!startDateStr && !endDateStr) return dataArray; // No filter

  const start = startDateStr ? new Date(startDateStr) : null;
  const end = endDateStr ? new Date(endDateStr) : null;
  // Set end date to end of day
  if (end) end.setHours(23, 59, 59, 999);

  return dataArray.filter(item => {
    // Asumsi item.tanggal format "DD/MM/YYYY HH:mm" atau "DD/MM/YYYY"
    // Kita perlu parse manual karena format Indo
    if (!item.tanggal) return false;

    // Split date & time
    const [datePart, timePart] = item.tanggal.split(" ");
    const [day, month, year] = datePart.split("/");

    // Create Date object (Month is 0-indexed)
    const itemDate = new Date(year, month - 1, day);

    if (start && itemDate < start) return false;
    if (end && itemDate > end) return false;

    return true;
  });
}


// --- 4. EXPORT TO EXCEL (CSV) ---
btnExportRiwayat.addEventListener("click", () => {
  // Get current displayed data (bisa filtered)
  // Disini saya ambil dari logic filter ulang biar konsisten
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(operationalHistoryData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data untuk diexport");
    return;
  }

  // Format Data untuk CSV
  const csvData = dataToExport.map(item => ({
    Tanggal: item.tanggal,
    "Jam Nyala": item.jam_nyala,
    Durasi: item.durasi,
    "Konsumsi BBM": item.konsumsi_bbm,
    Status: item.status
  }));

  exportToCSV(csvData, "Riwayat_Operasional_Genset.csv");
});

btnExportLogs.addEventListener("click", () => {
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(fuelLogData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data log untuk diexport");
    return;
  }

  const csvData = dataToExport.map(item => {
    let volAwal = parseFloat(item.volume_awal || 0);
    let volAkhir = parseFloat(item.volume_akhir || 0);
    let diff = volAkhir - volAwal;
    let changeText = (diff >= 0 ? "+" : "") + diff.toFixed(1);

    return {
      Tanggal: item.tanggal,
      "Volume Awal": volAwal,
      "Volume Akhir": volAkhir,
      "Perubahan": changeText,
      Status: item.status
    };
  });

  exportToCSV(csvData, "Log_Bahan_Bakar.csv");
});

function exportToCSV(data, filename) {
  if (!data || !data.length) return;

  const separator = ",";
  const keys = Object.keys(data[0]);

  // Header
  let csvContent = keys.join(separator) + "\n";

  // Body
  data.forEach(row => {
    const rowStr = keys.map(k => {
      let val = row[k] ? row[k].toString() : "";
      // Escape quote if needed
      if (val.includes(",")) val = `"${val}"`;
      return val;
    }).join(separator);
    csvContent += rowStr + "\n";
  });

  // Create Download Link
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
