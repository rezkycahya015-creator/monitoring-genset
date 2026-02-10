#include "time.h"
#include <ArduinoJson.h>
#include <ETH.h> // Ethernet Library
#include <FirebaseESP32.h>
#include <Preferences.h>
#include <UniversalTelegramBot.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// ==========================================
// 1. HARDWARE & FACTORY CONFIG
// ==========================================
#define TRIGGER_PIN 4
#define ECHO_PIN 33
#define SOUND_SPEED 0.0343

// ETH Config (LAN8720)
#define ETH_TYPE ETH_PHY_LAN8720
#define ETH_ADDR 1
#define ETH_POWER -1
#define ETH_MDC 23
#define ETH_MDIO 18
#define ETH_CLK_MODE ETH_CLOCK_GPIO17_OUT

// Factory Fallback WiFi (Used if configured WiFi fails)
#define FACTORY_WIFI_SSID "wifi-iot"
#define FACTORY_WIFI_PASS "password-iot"

// Firebase Config (Hardcoded Project Credentials)
#define FIREBASE_HOST                                                          \
  "monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "xmLz3TvFaWb3YZ8RWXjdlzfowdxQEv7GtAwDi0Z2"

// NTP Time
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 7 * 3600; // WIB
const int daylightOffset_sec = 0;

// ==========================================
// 2. GLOBALS & OBJECTS
// ==========================================
Preferences preferences;
WiFiClientSecure client;
UniversalTelegramBot *bot;
FirebaseData firebaseData;
FirebaseConfig config;
FirebaseAuth auth;

String deviceID; // Generated from MAC

// Configuration Variables (Synced with Preferences & Firebase)
String cfg_alias = "Unconfigured Device";
float cfg_tankLength = 100.0;
float cfg_tankWidth = 100.0;
float cfg_tankHeight = 100.0;
float cfg_engineLPH = 20.0;
String cfg_wifiSSID = "";
String cfg_wifiPass = "";
String cfg_tgToken = "";
String cfg_tgChatId = "";
bool cfg_isActive = false;

// Ethernet Config
bool cfg_ethEnable = false;
bool cfg_ethStatic = false;
String cfg_ethIP = "";
String cfg_ethGateway = "";
String cfg_ethSubnet = "";
String cfg_ethDNS1 = "";
String cfg_ethDNS2 = "";

// Runtime Logic Variables
float currentVolume = 0;
float lastLoggedVolume = 0; // For 1-minute logic
float lastSentVolume = -1;  // For avoiding spam updates
unsigned long lastCheckTime = 0;
const long CHECK_INTERVAL = 60000; // 1 minute

bool ethConnected = false;

// Engine Logic
bool isMachineRunning = false;
float startVolume = 0;
unsigned long startTime = 0;
String startTimeStr = "";
float thresholdStart = 0;
float thresholdStop = 0;
bool isLowFuelNotified = false;

// Smoothing
#define NUM_READINGS 10
float distanceReadings[NUM_READINGS];
int readIndex = 0;
float totalDistance = 0;
float averageDistance = 0;

// ==========================================
// 3. UTILITY FUNCTIONS
// ==========================================

// WiFi & Ethernet Event Handler
void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
  case ARDUINO_EVENT_ETH_START:
    Serial.println("ETH Started");
    Serial.print("ETH Setting Hostname: ");
    Serial.println(deviceID);
    ETH.setHostname(deviceID.c_str());
    break;
  case ARDUINO_EVENT_ETH_CONNECTED:
    Serial.println("ETH Connected");
    break;
  case ARDUINO_EVENT_ETH_GOT_IP:
    Serial.print("ETH MAC: ");
    Serial.print(ETH.macAddress());
    Serial.print(", IPv4: ");
    Serial.print(ETH.localIP());
    if (ETH.fullDuplex()) {
      Serial.print(", FULL_DUPLEX");
    }
    Serial.print(", ");
    Serial.print(ETH.linkSpeed());
    Serial.println("Mbps");
    ethConnected = true;
    break;
  case ARDUINO_EVENT_ETH_DISCONNECTED:
    Serial.println("ETH Disconnected");
    ethConnected = false;
    break;
  case ARDUINO_EVENT_ETH_STOP:
    Serial.println("ETH Stopped");
    ethConnected = false;
    break;
  default:
    break;
  }
}

// Generate Unique ID from MAC
void generateDeviceID() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[20];
  snprintf(buf, sizeof(buf), "GENSET_%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceID = String(buf);

  Serial.println("\n################################");
  Serial.printf(" DEVICE ID: %s \n", deviceID.c_str());
  Serial.printf(" MAC ADDR : %s \n", WiFi.macAddress().c_str());
  Serial.println("################################\n");
}

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo))
    return "N/A";
  char locTime[25];
  strftime(locTime, sizeof(locTime), "%d/%m/%Y %H:%M:%S", &timeinfo);
  return String(locTime);
}

// ==========================================
// 4. PREFERENCES (LOCAL STORAGE)
// ==========================================

void loadConfig() {
  Serial.println("[PREFS] Loading config...");
  preferences.begin("genset_cfg", true); // Read-only

  cfg_alias = preferences.getString("alias", "Unconfigured");
  cfg_tankLength = preferences.getFloat("len", 100.0);
  cfg_tankWidth = preferences.getFloat("wid", 100.0);
  cfg_tankHeight = preferences.getFloat("hgt", 100.0);
  cfg_engineLPH = preferences.getFloat("lph", 20.0);
  cfg_wifiSSID = preferences.getString("ssid", "");
  cfg_wifiPass = preferences.getString("pass", "");
  cfg_tgToken = preferences.getString("tgt", "");
  cfg_tgChatId = preferences.getString("tgid", "");
  cfg_isActive = preferences.getBool("active", false);

  // Ethernet
  cfg_ethEnable = preferences.getBool("eth_en", false);
  cfg_ethStatic = preferences.getBool("eth_stat", false);
  cfg_ethIP = preferences.getString("eth_ip", "");
  cfg_ethGateway = preferences.getString("eth_gw", "");
  cfg_ethSubnet = preferences.getString("eth_sub", "");
  cfg_ethDNS1 = preferences.getString("eth_d1", "");
  cfg_ethDNS2 = preferences.getString("eth_d2", "");

  preferences.end();

  // Recalculate Thresholds
  float consumptionPerMin = cfg_engineLPH / 60.0;
  thresholdStart = consumptionPerMin * 0.8; // Tolerance
  thresholdStop = consumptionPerMin * 0.3;

  Serial.printf("[CONFIG] Alias: %s | LPH: %.2f | SSID: %s\n",
                cfg_alias.c_str(), cfg_engineLPH, cfg_wifiSSID.c_str());

  if (cfg_tgToken.length() > 10) {
    bot = new UniversalTelegramBot(cfg_tgToken, client);
  }
}

void saveConfig() {
  Serial.println("[PREFS] Saving config...");
  preferences.begin("genset_cfg", false); // Read-Write

  preferences.putString("alias", cfg_alias);
  preferences.putFloat("len", cfg_tankLength);
  preferences.putFloat("wid", cfg_tankWidth);
  preferences.putFloat("hgt", cfg_tankHeight);
  preferences.putFloat("lph", cfg_engineLPH);
  preferences.putString("ssid", cfg_wifiSSID);
  preferences.putString("pass", cfg_wifiPass);
  preferences.putString("tgt", cfg_tgToken);
  preferences.putString("tgid", cfg_tgChatId);
  preferences.putBool("active", cfg_isActive);

  // Ethernet
  preferences.putBool("eth_en", cfg_ethEnable);
  preferences.putBool("eth_stat", cfg_ethStatic);
  preferences.putString("eth_ip", cfg_ethIP);
  preferences.putString("eth_gw", cfg_ethGateway);
  preferences.putString("eth_sub", cfg_ethSubnet);
  preferences.putString("eth_d1", cfg_ethDNS1);
  preferences.putString("eth_d2", cfg_ethDNS2);

  preferences.end();
}

// ==========================================
// 5. NETWORK & FIREBASE
// ==========================================

void uploadNetworkStatus() {
  if (WiFi.status() == WL_CONNECTED || ethConnected) {
    String path = "/devices/" + deviceID + "/status";
    FirebaseJson json;

    if (ethConnected) {
      json.set("ip_address", ETH.localIP().toString());
      json.set("ssid", "ETHERNET (LAN)");
      json.set("rssi", "100");
    } else {
      json.set("ip_address", WiFi.localIP().toString());
      json.set("ssid", WiFi.SSID());
      json.set("rssi", WiFi.RSSI());
    }
    json.set("last_online", getTimestamp());

    Firebase.setJSON(firebaseData, path, json);
  }
}

void syncFirebaseConfig() {
  if (WiFi.status() != WL_CONNECTED && !ethConnected)
    return;

  String path = "/devices/" + deviceID + "/config";
  if (Firebase.getJSON(firebaseData, path)) {
    FirebaseJson &json = firebaseData.jsonObject();
    FirebaseJsonData data;
    bool dirty = false;

// Macro helper to check & update
#define CHECK_UPD(type, key, var, setFunc)                                     \
  json.get(data, key);                                                         \
  if (data.success) {                                                          \
    type val = data.type##Value;                                               \
    if (val != var) {                                                          \
      var = val;                                                               \
      dirty = true;                                                            \
      Serial.printf("[SYNC] Update %s: " #type "\n", key);                     \
    }                                                                          \
  }

    // String needs special handling because FirebaseJsonData uses stringValue
    // (not StringValue)
    json.get(data, "alias");
    if (data.success && data.stringValue != cfg_alias) {
      cfg_alias = data.stringValue;
      dirty = true;
    }

    json.get(data, "wifi/ssid");
    if (data.success && data.stringValue != cfg_wifiSSID) {
      cfg_wifiSSID = data.stringValue;
      dirty = true;
    }

    json.get(data, "wifi/pass");
    if (data.success && data.stringValue != cfg_wifiPass) {
      cfg_wifiPass = data.stringValue;
      dirty = true;
    }

    json.get(data, "telegram/bot_token");
    if (data.success && data.stringValue != cfg_tgToken) {
      cfg_tgToken = data.stringValue;
      dirty = true;
    }

    json.get(data, "telegram/chat_id");
    if (data.success && data.stringValue != cfg_tgChatId) {
      cfg_tgChatId = data.stringValue;
      dirty = true;
    }

    json.get(data, "isActive");
    if (data.success && data.boolValue != cfg_isActive) {
      cfg_isActive = data.boolValue;
      dirty = true;
    }

    // Ethernet Parsing
    json.get(data, "ethernet/enable");
    if (data.success && data.boolValue != cfg_ethEnable) {
      cfg_ethEnable = data.boolValue;
      dirty = true;
    }

    json.get(data, "ethernet/static");
    if (data.success && data.boolValue != cfg_ethStatic) {
      cfg_ethStatic = data.boolValue;
      dirty = true;
    }

    json.get(data, "ethernet/ip");
    if (data.success && data.stringValue != cfg_ethIP) {
      cfg_ethIP = data.stringValue;
      dirty = true;
    }

    json.get(data, "ethernet/gateway");
    if (data.success && data.stringValue != cfg_ethGateway) {
      cfg_ethGateway = data.stringValue;
      dirty = true;
    }

    json.get(data, "ethernet/subnet");
    if (data.success && data.stringValue != cfg_ethSubnet) {
      cfg_ethSubnet = data.stringValue;
      dirty = true;
    }

    json.get(data, "ethernet/dns1");
    if (data.success && data.stringValue != cfg_ethDNS1) {
      cfg_ethDNS1 = data.stringValue;
      dirty = true;
    }

    json.get(data, "ethernet/dns2");
    if (data.success && data.stringValue != cfg_ethDNS2) {
      cfg_ethDNS2 = data.stringValue;
      dirty = true;
    }

    // Floats
    json.get(data, "tank/length");
    if (data.success && abs(data.floatValue - cfg_tankLength) > 0.01) {
      cfg_tankLength = data.floatValue;
      dirty = true;
    }

    json.get(data, "tank/width");
    if (data.success && abs(data.floatValue - cfg_tankWidth) > 0.01) {
      cfg_tankWidth = data.floatValue;
      dirty = true;
    }

    json.get(data, "tank/height");
    if (data.success && abs(data.floatValue - cfg_tankHeight) > 0.01) {
      cfg_tankHeight = data.floatValue;
      dirty = true;
    }

    json.get(data, "engine/consumption_lph");
    if (data.success && abs(data.floatValue - cfg_engineLPH) > 0.01) {
      cfg_engineLPH = data.floatValue;
      dirty = true;
    }

    if (dirty) {
      Serial.println("[SYNC] Configuration updated from Cloud! Saving...");
      saveConfig();
      // Re-init logic
      float consumptionPerMin = cfg_engineLPH / 60.0;
      thresholdStart = consumptionPerMin * 0.8;
      thresholdStop = consumptionPerMin * 0.3;

      // If Telegram changed, re-init bot
      if (cfg_tgToken.length() > 10) {
        if (bot)
          delete bot;
        bot = new UniversalTelegramBot(cfg_tgToken, client);
      }

      // If Ethernet settings changed, we might need to restart or re-init ETH
      // (Simpler to just save and let user reboot or implement re-init)
      Serial.println("Please restart device to apply Ethernet changes.");
    }
  }
}

void connectNetwork() {
  // 1. ETHERNET INIT
  if (cfg_ethEnable) {
    Serial.println("[ETH] Initializing Ethernet LAN8720...");

    if (cfg_ethStatic && cfg_ethIP.length() > 7) {
      IPAddress ip, gw, sub, d1, d2;
      ip.fromString(cfg_ethIP);
      gw.fromString(cfg_ethGateway);
      sub.fromString(cfg_ethSubnet);

      if (cfg_ethDNS1.length() > 7)
        d1.fromString(cfg_ethDNS1);
      else
        d1.fromString("8.8.8.8");

      if (cfg_ethDNS2.length() > 7)
        d2.fromString(cfg_ethDNS2);
      else
        d2.fromString("8.8.4.4");

      ETH.config(ip, gw, sub, d1, d2);
      Serial.println("[ETH] Static IP Configured.");
    }

    ETH.begin(ETH_TYPE, ETH_ADDR, ETH_MDC, ETH_MDIO, ETH_POWER, ETH_CLK_MODE);

    // Wait for ETH connection (optional, can run parallel with WiFi)
    unsigned long start = millis();
    while (!ethConnected && millis() - start < 5000) {
      delay(100);
    }
  }

  // 2. WIFI INIT (Only if not using Ethernet or as backup, here we try both)

  WiFi.mode(WIFI_STA);

  // Try Configured WiFi
  if (cfg_wifiSSID.length() > 1) {
    Serial.printf("[WIFI] Connecting to Saved: %s\n", cfg_wifiSSID.c_str());
    WiFi.begin(cfg_wifiSSID.c_str(), cfg_wifiPass.c_str());

    // Non-blocking wait if ETH is already connected, otherwise block briefly
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 15) {
      delay(500);
      Serial.print(".");
      retries++;
    }
  }

  // Fallback if not connected to either
  if (WiFi.status() != WL_CONNECTED && !ethConnected) {
    Serial.println("\n[WIFI] Saved WiFi Failed. Trying Factory WiFi...");
    WiFi.disconnect();
    WiFi.begin(FACTORY_WIFI_SSID, FACTORY_WIFI_PASS);

    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) {
      delay(500);
      Serial.print("F");
      retries++;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Not connected (using ETH or Offline).");
  }
}

// ==========================================
// 6. SENSOR LOGIC
// ==========================================

float readSensor() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0)
    return -1;

  float dist = duration * SOUND_SPEED / 2;
  return dist; // cm
}

float getSmoothedDistance() {
  float raw = readSensor();

  // BLIND SPOT HANDLING:
  // If distance is valid (>0) but very close (<23cm), treat as FULL tank (0
  // distance).
  if (raw > 0 && raw < 23.0) {
    raw = 0;
  } else if (raw < 0 || raw > 400) {
    return -1; // Invalid
  }

  // Subtract the oldest reading
  totalDistance = totalDistance - distanceReadings[readIndex];
  // Read new
  distanceReadings[readIndex] = raw;
  // Add new
  totalDistance = totalDistance + distanceReadings[readIndex];
  // Advance index
  readIndex = readIndex + 1;
  if (readIndex >= NUM_READINGS) {
    readIndex = 0;
  }

  averageDistance = totalDistance / NUM_READINGS;
  return averageDistance;
}
/* ... existing setup ... */

void setup() {
  Serial.begin(115200);
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Initialize smoothing array
  for (int i = 0; i < NUM_READINGS; i++) {
    distanceReadings[i] = 0;
  }

  // REGISTER EVENT HANDLER FOR WIFI & ETH
  WiFi.onEvent(WiFiEvent);

  generateDeviceID();
  loadConfig();
  connectNetwork();

  // Firebase Init
  client.setInsecure();
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Time Sync
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  // Upload status on boot
  uploadNetworkStatus();

  // Initial Sync
  syncFirebaseConfig();
}

void loop() {
  // A. Sensor Reading (Frequent)
  float dist = getSmoothedDistance();

  // Validasi & Kalkulasi Volume
  if (dist > 0) {
    // Clamp distance to tank height
    if (dist > cfg_tankHeight)
      dist = cfg_tankHeight;

    // Calculate Fuel Height
    float fuelHeight = cfg_tankHeight - dist;

    // Calculate Volume Liter
    currentVolume = (cfg_tankLength * cfg_tankWidth * fuelHeight) / 1000.0;

    // Send Realtime Data (Only if changed significantly > 0.2L)
    if (abs(currentVolume - lastSentVolume) > 0.2) {
      String basePath = "/devices/" + deviceID + "/data";
      Firebase.setFloat(firebaseData, basePath + "/volume", currentVolume);
      Firebase.setInt(firebaseData, basePath + "/tinggi", (int)fuelHeight);
      lastSentVolume = currentVolume;
    }
  }

  // B. 1-Minute Logic (Engine Status & Logs)
  if (millis() - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = millis();

    // Sync Config & Status
    syncFirebaseConfig();
    uploadNetworkStatus();

    // Init lastLoggedVolume if first run
    if (lastLoggedVolume == 0)
      lastLoggedVolume = currentVolume;

    float delta = lastLoggedVolume - currentVolume;

    // 1. REFUELING DETECTED (Increase > 3L)
    if (delta < -3.0 && !isMachineRunning) {
      float refuelAmount = abs(delta);

      FirebaseJson log;
      log.set("tanggal", getTimestamp());
      log.set("volume_awal", lastLoggedVolume);
      log.set("volume_akhir", currentVolume);
      log.set("status", "Pengisian");
      Firebase.pushJSON(firebaseData, "/devices/" + deviceID + "/data/logs",
                        log);

      if (bot && cfg_tgChatId.length() > 5) {
        String msg = "⛽ <b>PENGISIAN DETECTED!</b>\n";
        msg += "Unit: " + cfg_alias + "\n";
        msg += "Waktu: " + getTimestamp() + "\n";
        msg += "Awal: " + String(lastLoggedVolume, 1) + " L\n";
        msg += "Akhir: " + String(currentVolume, 1) + " L\n";
        msg += "Isi: +" + String(refuelAmount, 1) + " L";
        bot->sendMessage(cfg_tgChatId, msg, "HTML");
      }
      lastLoggedVolume = currentVolume; // Reset baseline
      return;
    }

    // 2. ENGINE START DETECTION
    if (!isMachineRunning && delta > thresholdStart) {
      // Consider running if consumption exceeds threshold
      isMachineRunning = true;
      startTime = millis();
      startVolume = lastLoggedVolume; // Use volume before drop
      startTimeStr = getTimestamp();

      Serial.println("ENGINE STARTED");
      if (bot && cfg_tgChatId.length() > 5) {
        String msg = "⚠️ <b>GENSET MENYALA!</b>\n";
        msg += "Waktu: " + startTimeStr + "\n";
        msg += "Volume Awal: " + String(startVolume, 1) + " L";
        bot->sendMessage(cfg_tgChatId, msg, "HTML");
      }
    }

    // 3. ENGINE STOP DETECTION
    if (isMachineRunning && delta < thresholdStop) {
      // Engine stopped
      isMachineRunning = false;

      long durationMins = (millis() - startTime) / 60000;
      float totalConsumed = startVolume - currentVolume;
      if (totalConsumed < 0)
        totalConsumed = 0;

      Serial.println("ENGINE STOPPED");

      // Calculate Efficiency Status
      String status = "Normal";
      float expectedConsumption = (durationMins / 60.0) * cfg_engineLPH;

      if (expectedConsumption > 0) {
        if (totalConsumed > (expectedConsumption * 1.2)) {
          status = "Boros";
        } else if (totalConsumed < (expectedConsumption * 0.8)) {
          status = "Hemat";
        }
      }

      // Log History
      FirebaseJson his;
      his.set("tanggal", startTimeStr);
      his.set("jam_nyala", startTimeStr.substring(11, 16)); // HH:MM
      his.set("durasi", String(durationMins) + " Menit");
      his.set("konsumsi_bbm", String(totalConsumed, 1) + " L");
      his.set("status", status);
      Firebase.pushJSON(firebaseData, "/devices/" + deviceID + "/data/history",
                        his);

      if (bot && cfg_tgChatId.length() > 5) {
        String msg = "✅ <b>GENSET MATI</b>\n";
        msg += "Unit: " + cfg_alias + "\n";
        msg += "Durasi: " + String(durationMins) + " Menit\n";
        msg += "Konsumsi: " + String(totalConsumed, 1) + " L\n";
        msg += "Sisa BBM: " + String(currentVolume, 1) + " L\n";
        msg += "Status: " + status; // Update status in Telegram too
        bot->sendMessage(cfg_tgChatId, msg, "HTML");
      }
    }

    lastLoggedVolume = currentVolume;

    // 4. LOW FUEL ALERT (Instant First Alert, then throttled)
    // Calculate Max Volume based on Config
    float maxVol = (cfg_tankLength * cfg_tankWidth * cfg_tankHeight) / 1000.0;

    if (maxVol > 0) {
      float pct = (currentVolume / maxVol) * 100.0;

      // TRIGGER: Below 20%
      if (pct < 20.0) {
        // If not yet notified, send IMMEDIATELY
        if (!isLowFuelNotified) {
          if (bot && cfg_tgChatId.length() > 5) {
            String msg = "⚠️ <b>PERINGATAN: BENSIN KRITIS!</b>\n";
            msg += "Waktu: " + getTimestamp() + "\n";
            msg += "Sisa BBM: " + String(currentVolume, 1) + " L ( " +
                   String(pct, 0) + "% )\n";
            msg += "Segera lakukan pengisian ulang!";
            bot->sendMessage(cfg_tgChatId, msg, "HTML");
          }
          isLowFuelNotified = true; // Mark as notified
        }
      }
      // RESET: Above 25% (Hysteresis)
      else if (pct > 25.0) {
        isLowFuelNotified = false;
      }
    }
  }

  delay(100);
}
