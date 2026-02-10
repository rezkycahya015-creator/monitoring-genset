#include "time.h"
#include <ArduinoJson.h>
#include <FirebaseESP32.h>
#include <Preferences.h> // Library untuk penyimpanan persisten (Flash)
#include <UniversalTelegramBot.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiMulti.h>

// ==========================================
// 1. KONFIGURASI DAN MAKRRO
// ==========================================

// WiFi Default (Fallback/Factory)
// Digunakan hanya jika WiFi konfigurasi (Saved) gagal.
#define FACTORY_WIFI_SSID "wifi-iot"
#define FACTORY_WIFI_PASS "password-iot"

// Firebase Credentials
// Host & Auth Token untuk proyek Firebase Anda
#define FIREBASE_HOST                                                          \
  "monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "xmLz3TvFaWb3YZ8RWXjdlzfowdxQEv7GtAwDi0Z2"

// Hardware Pin Definitions
#define TRIGGER_PIN 4
#define ECHO_PIN 33
#define SOUND_SPEED 0.0343

// ==========================================
// 2. VARIABEL GLOBAL
// ==========================================

// --- Identitas & Koneksi ---
String deviceID = "";    // Otomatis (Format: GENSET_XXXXXX)
Preferences preferences; // Object untuk akses Flash Memory
WiFiMulti wifiMulti;
WiFiClientSecure client;
UniversalTelegramBot *bot;

// --- Data Firebase Helper ---
FirebaseData firebaseData;
FirebaseConfig config;
FirebaseAuth auth;

// --- Variabel Konfigurasi (Disimpan di Preferences) ---
// Default values jika belum ada config tersimpan
String cfg_alias = "Genset Unconfigured";
float cfg_tankLength = 85.0; // cm
float cfg_tankWidth = 60.0;  // cm
float cfg_tankHeight = 90.0; // cm
float cfg_engineLPH = 50.0;  // Liter/Hour
String cfg_wifiSSID = "";    // Configured WiFi
String cfg_wifiPass = "";
String cfg_tgToken = "";  // Telegram Token
String cfg_tgChatId = ""; // Telegram Chat ID

// --- Runtime Calculations ---
float maxVolumeLiter = 0;
float thresholdStart = 0;
float thresholdStop = 0;

// --- Variabel Operasional ---
float lastVolume = 0;
float volumeSatuMenitLalu = 0;
float startVolume = 0;
float lastSentVolume = -1;
unsigned long startTime = 0;
String startTimeStr = "";
bool isConfigLoaded = false;
bool isMachineRunning = false;
bool isLowFuelNotified = false;

// Counters
int counterPenurunan = 0;
int counterDiam = 0;
unsigned long lastCheckTime = 0;
const long CHECK_INTERVAL = 60000; // 1 Menit

// Time Sync
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600; // WIB
const int daylightOffset_sec = 0;

// ==========================================
// 3. FUNGSI UTILITAS & IDENTITAS
// ==========================================

// Generate Device ID dari MAC Address
void generateDeviceID() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char idBuffer[20];
  // Format: GENSET_A1B2C3
  snprintf(idBuffer, sizeof(idBuffer), "GENSET_%02X%02X%02X", mac[3], mac[4],
           mac[5]);
  deviceID = String(idBuffer);

  Serial.println("\n==================================");
  Serial.println("IDENTITY GENERATED");
  Serial.print("Device MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.print("Device ID : ");
  Serial.println(deviceID);
  Serial.println("==================================\n");
}

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo))
    return "Unknown Time";
  char buffer[20];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M", &timeinfo);
  return String(buffer);
}

// Logic Threshold berdasarkan Konsumsi BBM
void recalculateLogic() {
  // 1. Max Volume (Liter)
  maxVolumeLiter = (cfg_tankLength * cfg_tankWidth * cfg_tankHeight) / 1000.0;

  // 2. Threshold Start/Stop
  // Konsumsi per menit
  float consumptionPerMinute = cfg_engineLPH / 60.0;

  // Start: Penurunan > 80% dari konsumsi normal
  thresholdStart = consumptionPerMinute * 0.8;

  // Stop: Penurunan < 30% dari konsumsi normal (diasumsikan noise/stabil)
  thresholdStop = consumptionPerMinute * 0.3;

  Serial.println("--- LOGIC UPDATED ---");
  Serial.printf("Vol Max: %.1f L\n", maxVolumeLiter);
  Serial.printf("Start Threshold: > %.3f L/min\n", thresholdStart);
  Serial.printf("Stop Threshold : < %.3f L/min\n", thresholdStop);
}

// ==========================================
// 4. MANAJEMEN PREFERENCES (FLASH STORAGE)
// ==========================================

void loadPreferences() {
  Serial.println("Loading Preferences...");
  preferences.begin("genset-cfg",
                    true); // Read-only mode = false, tapi kita butuh RW nanti
  // Tapi disini true mode hanya Read Only? No, begin(name, readOnly).
  // Kita pakai false agar bisa write jika perlu inisialisasi awal (jarang).
  // Sebaiknya load mode true (RO) cukup, saat save baru false (RW).

  // Kita tutup dulu dan buka mode RO
  preferences.end();
  preferences.begin("genset-cfg", true);

  cfg_alias = preferences.getString("alias", "Genset Unconfigured");
  cfg_tankLength = preferences.getFloat("len", 85.0);
  cfg_tankWidth = preferences.getFloat("wid", 60.0);
  cfg_tankHeight = preferences.getFloat("hgt", 90.0);
  cfg_engineLPH = preferences.getFloat("lph", 50.0);

  cfg_wifiSSID = preferences.getString("ssid", "");
  cfg_wifiPass = preferences.getString("pass", "");

  cfg_tgToken = preferences.getString("tg_tok", "");
  cfg_tgChatId = preferences.getString("tg_id", "");

  preferences.end();

  recalculateLogic();

  // Init Bot jika token ada
  if (cfg_tgToken.length() > 5) {
    bot = new UniversalTelegramBot(cfg_tgToken, client);
  }
}

void savePreferences() {
  Serial.println("Saving Config to Flash...");
  preferences.begin("genset-cfg", false); // Read-Write Mode

  preferences.putString("alias", cfg_alias);
  preferences.putFloat("len", cfg_tankLength);
  preferences.putFloat("wid", cfg_tankWidth);
  preferences.putFloat("hgt", cfg_tankHeight);
  preferences.putFloat("lph", cfg_engineLPH);

  preferences.putString("ssid", cfg_wifiSSID);
  preferences.putString("pass", cfg_wifiPass);

  preferences.putString("tg_tok", cfg_tgToken);
  preferences.putString("tg_id", cfg_tgChatId);

  preferences.end();
  Serial.println("Config Saved!");
}

// ==========================================
// 5. KONEKSI & SYNC
// ==========================================

void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  wifiMulti.cleanAPlist(); // Bersihkan list lama

  // 1. Prioritas: Configured WiFi (Dari Preferences)
  if (cfg_wifiSSID.length() > 0) {
    Serial.printf("Priority 1: Connecting to Saved WiFi [%s]...\n",
                  cfg_wifiSSID.c_str());
    wifiMulti.addAP(cfg_wifiSSID.c_str(), cfg_wifiPass.c_str());
  }

  // 2. Fallback: Factory WiFi
  Serial.printf("Priority 2: Fallback WiFi [%s]\n", FACTORY_WIFI_SSID);
  wifiMulti.addAP(FACTORY_WIFI_SSID, FACTORY_WIFI_PASS);

  int retry = 0;
  while (wifiMulti.run() != WL_CONNECTED && retry < 15) {
    delay(1000);
    Serial.print(".");
    retry++;
  }

  if (wifiMulti.run() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("IP  : ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi Connection Failed. Running Offline Logic.");
  }
}

void checkFirebaseConfig() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  // Cek path config di firebase
  String path = "/devices/" + deviceID + "/config";

  if (Firebase.getJSON(firebaseData, path)) {
    FirebaseJson &json = firebaseData.jsonObject();
    FirebaseJsonData res;

    bool needSave = false;

// Helper macro to update if changed
#define UPDATE_STR(key, var)                                                   \
  json.get(res, key);                                                          \
  if (res.success && res.stringValue != var) {                                 \
    var = res.stringValue;                                                     \
    needSave = true;                                                           \
    Serial.println("Updated " key);                                            \
  }

#define UPDATE_FLOAT(key, var)                                                 \
  json.get(res, key);                                                          \
  if (res.success && abs(res.floatValue - var) > 0.01) {                       \
    var = res.floatValue;                                                      \
    needSave = true;                                                           \
    Serial.println("Updated " key);                                            \
  }

    UPDATE_STR("alias", cfg_alias);
    UPDATE_FLOAT("tank/length", cfg_tankLength);
    UPDATE_FLOAT("tank/width", cfg_tankWidth);
    UPDATE_FLOAT("tank/height", cfg_tankHeight);
    UPDATE_FLOAT("engine/consumption_lph", cfg_engineLPH);

    // WiFi update (Hati-hati, jika salah ganti, alat bisa putus)
    UPDATE_STR("wifi/ssid", cfg_wifiSSID);
    json.get(res, "wifi/pass");
    if (res.success && res.stringValue != cfg_wifiPass) {
      cfg_wifiPass = res.stringValue;
      needSave = true;
    }

    // Telegram
    UPDATE_STR("telegram/bot_token", cfg_tgToken);
    UPDATE_STR("telegram/chat_id", cfg_tgChatId);

    if (needSave) {
      savePreferences();
      recalculateLogic();

      // Re-init bot
      if (cfg_tgToken.length() > 5) {
        delete bot;
        bot = new UniversalTelegramBot(cfg_tgToken, client);
      }
    }
  }
}

// ==========================================
// 6. SETUP UTAMA
// ==========================================

void setup() {
  Serial.begin(115200);
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // 1. Generate Identity
  generateDeviceID();

  // 2. Load Config from Flash
  loadPreferences();

  // 3. Connect WiFi
  connectToWiFi();

  // 4. Time Sync & Firebase
  client.setInsecure();
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // 5. Initial Config Check (Sync Cloud to Flash)
  checkFirebaseConfig();

  // 6. Boot Notification
  if (bot && cfg_tgChatId.length() > 5) {
    String msg = "🚀 <b>GENSET ONLINE</b>\n";
    msg += "ID: " + deviceID + "\n";
    msg += "Alias: " + cfg_alias + "\n";
    msg += "IP: " + WiFi.localIP().toString();
    bot->sendMessage(cfg_tgChatId, msg, "HTML");
  }
}

// ==========================================
// 7. SENSOR & LOGIC LOOP
// ==========================================

float getDistance() {
  float total = 0;
  int valid = 0;
  for (int i = 0; i < 10; i++) {
    digitalWrite(TRIGGER_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIGGER_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIGGER_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 25000); // Timeout 25ms
    if (duration > 0) {
      float dist = (duration * SOUND_SPEED) / 2;
      if (dist > 0 && dist < 400) {
        total += dist;
        valid++;
      }
    }
    delay(20);
  }
  return (valid > 0) ? (total / valid) : -1;
}

void loop() {
  // WiFi Monitor
  if (wifiMulti.run() != WL_CONNECTED) {
    // Retry logic handled by library, but we can log
  }

  // A. Baca Sensor
  float dist = getDistance();
  if (dist == -1) {
    delay(1000);
    return;
  } // Error reading

  // Clamp & Calculate
  if (dist > cfg_tankHeight)
    dist = cfg_tankHeight;
  float level = cfg_tankHeight - dist;
  if (level < 0)
    level = 0;

  float vol = (cfg_tankLength * cfg_tankWidth * level) / 1000.0;
  unsigned int tinggiUI = (unsigned int)level;

  // Init History
  if (volumeSatuMenitLalu == 0)
    volumeSatuMenitLalu = vol;

  // B. Kirim Realtime Data (Jika berubah signifikan)
  if (abs(vol - lastSentVolume) >= 0.2) {
    String basePath = "/devices/" + deviceID + "/data";
    Firebase.setFloat(firebaseData, basePath + "/volume", vol);
    Firebase.setInt(firebaseData, basePath + "/tinggi", tinggiUI);
    lastSentVolume = vol;
  }

  // C. Logika Per Menit
  if (millis() - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = millis();

    // Cek Periodik Config Baru
    checkFirebaseConfig();

    float delta = volumeSatuMenitLalu - vol;

    // 1. Deteksi Pengisian (Delta Negatif Besar)
    if (delta < -3.0 && !isMachineRunning) {
      // Logika Pengisian (Sama seperti sebelumnya)
      String msg = "⛽ <b>Pengisian Terdeteksi</b>\n";
      msg += "Total: " + String(abs(delta), 1) + " L";
      if (bot)
        bot->sendMessage(cfg_tgChatId, msg, "HTML");

      // Kirim Log ke Firebase
      FirebaseJson log;
      log.set("tanggal", getTimestamp());
      log.set("volume_awal", volumeSatuMenitLalu);
      log.set("volume_akhir", vol);
      log.set("status", "Pengisian");
      Firebase.pushJSON(firebaseData, "/devices/" + deviceID + "/data/logs",
                        log);

      volumeSatuMenitLalu = vol;
      return;
    }

    // 2. Deteksi Running
    if (!isMachineRunning) {
      if (delta > thresholdStart)
        counterPenurunan++;
      else
        counterPenurunan = 0;

      if (counterPenurunan >= 2) {
        isMachineRunning = true;
        startVolume = volumeSatuMenitLalu + delta;
        startTime = millis();
        startTimeStr = getTimestamp();

        if (bot) {
          String msg = "⚠️ <b>MESIN NYALA</b>\nAlias: " + cfg_alias;
          bot->sendMessage(cfg_tgChatId, msg, "HTML");
        }
        counterPenurunan = 0;
      }
    }
    // 3. Deteksi Stop
    else {
      if (delta < thresholdStop)
        counterDiam++;
      else
        counterDiam = 0;

      if (counterDiam >= 3) {
        isMachineRunning = false;
        long durasi = (millis() - startTime) / 60000;
        float konsumsi = startVolume - vol;
        if (konsumsi < 0)
          konsumsi = 0;

        // Kirim History
        FirebaseJson his;
        his.set("tanggal", startTimeStr);
        his.set("jam_nyala", startTimeStr.substring(11, 16));
        his.set("durasi", String(durasi) + " Menit");
        his.set("konsumsi_bbm", String(konsumsi, 1) + " L");
        his.set("status", "Normal");
        Firebase.pushJSON(firebaseData,
                          "/devices/" + deviceID + "/data/history", his);

        // Notif
        if (bot) {
          String msg = "✅ <b>MESIN MATI</b>\n";
          msg += "Durasi: " + String(durasi) + " Min\n";
          msg += "Konsumsi: " + String(konsumsi, 1) + " L";
          bot->sendMessage(cfg_tgChatId, msg, "HTML");
        }
        counterDiam = 0;
      }
    }

    volumeSatuMenitLalu = vol;

    // Low Fuel Alert (Setiap menit jika dibawah 20%)
    if (maxVolumeLiter > 0) {
      float pct = (vol / maxVolumeLiter) * 100.0;
      if (pct < 20.0 && !isLowFuelNotified) {
        if (bot)
          bot->sendMessage(cfg_tgChatId,
                           "🚨 <b>LOW FUEL:</b> " + String(pct, 0) + "%",
                           "HTML");
        isLowFuelNotified = true;
      } else if (pct > 25.0) {
        isLowFuelNotified = false;
      }
    }
  }

  delay(100);
}