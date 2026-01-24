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
  if (pageId === "user")
    document.getElementById("btn-user").classList.add("active");

  // Tutup sidebar jika di mobile setelah pindah halaman
  closeSidebar();

  // Tutup sidebar jika di mobile setelah pindah halaman
  closeSidebar();
}

// --- SIDEBAR TOGGLE LOGIC ---
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const btnToggleNav = document.getElementById("btn-toggle-nav");

btnToggleNav.addEventListener("click", () => {
  sidebar.classList.toggle("active");
  sidebarOverlay.classList.toggle("active");
});

sidebarOverlay.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar.classList.remove("active");
  sidebarOverlay.classList.remove("active");
}

// --- CONFIG FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyAnfF_Cs_wwyGaqB9Z91RwR9Fv7AR0jk2Y",
  authDomain: "monitoring-9bffa.firebaseapp.com",
  databaseURL: "https://monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "monitoring-9bffa",
  storageBucket: "monitoring-9bffa.firebasestorage.app",
  messagingSenderId: "893322341036",
  appId: "1:893322341036:web:e9a4c298dc41a73ca10d09",
  measurementId: "G-92ZKF4PY4J"
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
    // Urutkan berdasarkan tanggal descending (terbaru diatas)
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
        <td class="admin-only-col check-col">
            <input type="checkbox" class="admin-checkbox riwayat-check" value="${item.id}">
        </td>
        <td class="date-cell">
           <span>${item.tanggal || "-"}</span>
           <button class="btn-delete" onclick="deleteHistory('${item.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
        <td>${item.jam_nyala || "-"}</td>
        <td>${item.durasi || "-"}</td>
        <td>${item.konsumsi_bbm || "-"}</td>
        <td><span class="status-badge">${item.status || "Normal"}</span></td>
      </tr>
    `;
    riwayatTableBody.innerHTML += row;
  });
}


// 2. DATA LOG PERUBAHAN BAHAN BAKAR (PERSISTENT /genset/logs)
db.ref("/genset/logs").on("value", (snapshot) => {
  const data = snapshot.val();
  fuelLogData = [];

  if (data) {
    // Convert Object to Array
    Object.keys(data).forEach((key) => {
      fuelLogData.push({
        id: key,
        ...data[key],
      });
    });

    // Reverse agar terbaru diatas
    fuelLogData.reverse();
  }

  // Render Logs
  renderLogs(fuelLogData);
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
            <td class="admin-only-col check-col">
                <input type="checkbox" class="admin-checkbox logs-check" value="${item.id}">
            </td>
            <td class="date-cell">
              <span>${datePart}</span>
              <button class="btn-delete" onclick="deleteLog('${item.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
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


  // Toggle Expanded Class
  const isFiltered = startVal !== "" || endVal !== "";
  const riwayatContainer = document.getElementById("riwayat-container");
  const logsContainer = document.getElementById("logs-container");

  if (isFiltered) {
    riwayatContainer.classList.add("expanded");
    logsContainer.classList.add("expanded");
  } else {
    riwayatContainer.classList.remove("expanded");
    logsContainer.classList.remove("expanded");
  }
}

function filterDataByDate(dataArray, startDateStr, endDateStr) {
  if (!startDateStr && !endDateStr) return dataArray; // No filter

  let start = null;
  if (startDateStr) {
    const [sy, sm, sd] = startDateStr.split("-");
    start = new Date(sy, sm - 1, sd); // Local Midnight
  }

  let end = null;
  if (endDateStr) {
    const [ey, em, ed] = endDateStr.split("-");
    end = new Date(ey, em - 1, ed); // Local Midnight
    end.setHours(23, 59, 59, 999); // End of Day
  }

  return dataArray.filter(item => {
    // Asumsi item.tanggal format "DD/MM/YYYY HH:mm" atau "DD/MM/YYYY"
    if (!item.tanggal) return false;

    // Split date & time
    const [datePart, timePart] = item.tanggal.split(" ");
    const [day, month, year] = datePart.split("/");

    // Create Date object (Month is 0-indexed)
    // Ini creates Local Time
    const itemDate = new Date(year, month - 1, day);

    if (start && itemDate < start) return false;
    if (end && itemDate > end) return false;

    return true;
  });
}


// --- 4. EXPORT TO EXCEL (.xlsx) ---
btnExportRiwayat.addEventListener("click", () => {
  // Get current displayed data (bisa filtered)
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(operationalHistoryData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data untuk diexport");
    return;
  }

  // Format Data
  const formattedData = dataToExport.map(item => ({
    "Tanggal": item.tanggal,
    "Jam Nyala": item.jam_nyala,
    "Durasi": item.durasi,
    "Konsumsi BBM": item.konsumsi_bbm,
    "Status": item.status
  }));

  exportToExcel(formattedData, "Riwayat_Operasional_Genset");
});

btnExportLogs.addEventListener("click", () => {
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(fuelLogData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data log untuk diexport");
    return;
  }

  const formattedData = dataToExport.map(item => {
    let volAwal = parseFloat(item.volume_awal || 0);
    let volAkhir = parseFloat(item.volume_akhir || 0);
    let diff = volAkhir - volAwal;
    let changeText = (diff >= 0 ? "+" : "") + diff.toFixed(1);

    return {
      "Tanggal": item.tanggal,
      "Volume Awal": volAwal,
      "Volume Akhir": volAkhir,
      "Perubahan": changeText,
      "Status": item.status
    };
  });

  exportToExcel(formattedData, "Log_Bahan_Bakar");
});

function exportToExcel(data, filenameBase) {
  if (!data || !data.length) return;

  // Buat Worksheet
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Buat Workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

  // Generate File Excel
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}

// --- ADMIN FEATURES ---
// Check Session
if (localStorage.getItem('isAdmin') === 'true') {
  document.body.classList.add('is-admin');
  showAdminDashboard(true);
}

function adminLogin() {
  const user = document.getElementById('admin-user').value;
  const pass = document.getElementById('admin-pass').value;

  if (user === 'PengawasGenset' && pass === 'Pengawas') {
    alert('Login Berhasil! Mode Admin Aktif.');
    localStorage.setItem('isAdmin', 'true');
    document.body.classList.add('is-admin');
    showAdminDashboard(true);
  } else {
    alert('Username atau Password Salah!');
  }
}

function adminLogout() {
  localStorage.removeItem('isAdmin');
  document.body.classList.remove('is-admin');
  showAdminDashboard(false);
  document.getElementById('admin-user').value = "";
  document.getElementById('admin-pass').value = "";
}

function showAdminDashboard(isLoggedIn) {
  const loginForm = document.getElementById('login-form');
  const adminDash = document.getElementById('admin-dashboard');

  if (isLoggedIn) {
    loginForm.style.display = 'none';
    adminDash.style.display = 'block';
  } else {
    loginForm.style.display = 'block';
    adminDash.style.display = 'none';
  }
}

function deleteHistory(id) {
  if (confirm("Yakin ingin menghapus data riwayat ini?")) {
    db.ref('/genset/history/' + id).remove()
      .then(() => alert("Data terhapus!"))
      .catch((e) => alert("Gagal hapus: " + e.message));
  }
}

function deleteLog(id) {
  if (confirm("Yakin ingin menghapus log ini?")) {
    db.ref('/genset/logs/' + id).remove()
      .then(() => alert("Log terhapus!"))
      .catch((e) => alert("Gagal hapus: " + e.message));
  }
}

// --- BULK DELETE FEATURES ---
function toggleSelectAll(type) {
  const masterCheck = document.getElementById(type === 'riwayat' ? 'check-all-riwayat' : 'check-all-logs');
  const checkboxes = document.querySelectorAll(type === 'riwayat' ? '.riwayat-check' : '.logs-check');

  checkboxes.forEach(cb => cb.checked = masterCheck.checked);
}

function deleteSelected(type) {
  const checkboxes = document.querySelectorAll(type === 'riwayat' ? '.riwayat-check:checked' : '.logs-check:checked');

  if (checkboxes.length === 0) {
    alert("Pilih data yang ingin dihapus terlebih dahulu.");
    return;
  }

  if (confirm(`Yakin ingin menghapus ${checkboxes.length} data terpilih?`)) {
    const dbPath = type === 'riwayat' ? '/genset/history/' : '/genset/logs/';
    let promises = [];

    checkboxes.forEach(cb => {
      promises.push(db.ref(dbPath + cb.value).remove());
    });

    Promise.all(promises)
      .then(() => {
        alert("Berhasil menghapus " + checkboxes.length + " data.");
        // Uncheck master checkbox
        const masterCheck = document.getElementById(type === 'riwayat' ? 'check-all-riwayat' : 'check-all-logs');
        if (masterCheck) masterCheck.checked = false;
      })
      .catch((e) => alert("Terjadi kesalahan: " + e.message));
  }
}
