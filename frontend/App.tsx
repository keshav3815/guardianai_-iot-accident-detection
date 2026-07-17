import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Activity, Map as MapIcon, AlertTriangle, ShieldCheck, History,
  User as UserIcon, Navigation, Zap, RefreshCcw, AlertCircle,
  Newspaper, Settings, Mail, Lock, ArrowRight, Car, ChevronRight,
  X, Wifi, Battery, Thermometer, Clock, TrendingUp, TrendingDown,
  CheckCircle, Radio
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, BarChart, Bar
} from 'recharts';
import { SensorData, AIResponse, DetectionStatus, HistoryItem, User, NewsItem } from './types';
import { analyzeSafetyStatus } from './geminiService';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const INDIA_BASE_LAT = 28.6139;
const INDIA_BASE_LNG = 77.2090;
let routeOffset = 0;

const randRange = (min: number, max: number) => Math.random() * (max - min) + min;
// Sample a value biased toward the tails of [minMag, maxMag], with a random sign.
// Used for gyro_z in the minor/severe scenarios, where the real dataset shows
// the severity signal concentrated in large +/- excursions on that one axis
// rather than a mid-range value.
const randTail = (minMag: number, maxMag: number) => randRange(minMag, maxMag) * (Math.random() < 0.5 ? -1 : 1);

// Every range below is taken directly from the empirical per-axis min/max (or
// +/-1 std around the mean) of the backend model's training data
// (backend/sensor_raw.csv), bucketed by the same severity score used to train
// it. Earlier versions of this generator used an invented 0-20g/0-5rad-s
// scale that had no relationship to the real sensor data, so "Collision"
// clicks were classified as Normal by the model no matter how large they
// looked in the UI. Keep these in sync with train_model.py's thresholds if
// the dataset or labeling scheme changes.
const generateMockData = (scenario: 'normal' | 'minor' | 'severe' = 'normal'): SensorData => {
  const now = new Date();
  routeOffset += 0.00008;

  const scenarios = {
    normal: {
      accX: () => randRange(0.09, 0.43), accY: () => randRange(-0.20, 0.0), accZ: () => randRange(-1.05, -0.89),
      gyroX: () => randRange(-2.84, 1.60), gyroY: () => randRange(1.65, 5.91), gyroZ: () => randRange(-0.53, 2.43),
      vib: () => randRange(1, 5), speed: () => randRange(38, 50),
    },
    minor: {
      accX: () => randRange(-0.2, 0.75), accY: () => randRange(-0.55, 0.5), accZ: () => randRange(-1.35, -0.6),
      gyroX: () => randRange(-14.5, 10.5), gyroY: () => randRange(-8.5, 17), gyroZ: () => randTail(0, 25),
      vib: () => randRange(18, 53), speed: () => randRange(15, 23),
    },
    severe: {
      accX: () => randRange(-0.25, 0.55), accY: () => randRange(-0.8, 0.8), accZ: () => randRange(-1.35, -0.7),
      gyroX: () => randRange(-15, 13), gyroY: () => randRange(-10.5, 14.5), gyroZ: () => randTail(20, 50),
      vib: () => randRange(95, 150), speed: () => randRange(1, 5),
    },
  };
  const s = scenarios[scenario];

  return {
    accelerometer_x: parseFloat(s.accX().toFixed(3)),
    accelerometer_y: parseFloat(s.accY().toFixed(3)),
    accelerometer_z: parseFloat(s.accZ().toFixed(3)),
    gyroscope_x: parseFloat(s.gyroX().toFixed(4)),
    gyroscope_y: parseFloat(s.gyroY().toFixed(4)),
    gyroscope_z: parseFloat(s.gyroZ().toFixed(4)),
    vibration_level: parseFloat(s.vib().toFixed(2)),
    vehicle_speed: parseFloat(s.speed().toFixed(1)),
    gps_latitude: INDIA_BASE_LAT + routeOffset + (Math.random() * 0.00004),
    gps_longitude: INDIA_BASE_LNG + routeOffset * 0.7 + (Math.random() * 0.00004),
    timestamp: now.toISOString(),
  };
};

const MOCK_NEWS: NewsItem[] = [
  { id: '1', category: 'SYSTEM', title: 'Firmware v3.4.2 Released', content: 'Improved gyroscope calibration for Indian road conditions — pothole & speed-bump detection enhanced.', date: '2h ago' },
  { id: '2', category: 'NEWS', title: 'MoRTH Safety Update', content: 'Ministry of Road Transport mandates AI-assisted collision detection for all commercial fleets by Q3 2026.', date: '5h ago' },
  { id: '3', category: 'NEWS', title: 'Delhi Ring Road Alert', content: 'Heavy congestion near Dhaula Kuan. Fleet units advised to use NH-48 alternate route.', date: '8h ago' },
  { id: '4', category: 'WORK', title: 'Brake Pad Replacement', content: 'DL-1CA-2402: Brake pads replaced at Dwarka Service Centre. Technician #IN-402.', date: 'Yesterday' },
  { id: '5', category: 'WORK', title: 'OBD-II Sensor Sync', content: 'All 12 fleet vehicles synced with GuardianAI cloud. Diagnostics nominal.', date: 'Yesterday' },
];

function useUptime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function useLiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const MapCenterTracker: React.FC<{ center: [number, number] }> = ({ center }) => {
  const map = useMap();
  useEffect(() => { map.setView(center, map.getZoom(), { animate: true }); }, [center, map]);
  return null;
};

const getVehicleIcon = (status: string | null) => {
  const bg = status?.includes('Severe') ? '#ef4444' : status?.includes('Minor') ? '#f59e0b' : '#22c55e';
  return L.divIcon({
    html: `<div style="position:relative;width:44px;height:44px;">
      <div style="position:absolute;inset:4px;background:${bg};border:3px solid white;border-radius:50%;box-shadow:0 4px 18px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
        <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'>
          <rect x='1' y='3' width='15' height='13' rx='2'/><path d='M16 8h4l3 4v3h-7V8z'/><circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/>
        </svg>
      </div>
    </div>`,
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
};

const VehicleMap: React.FC<{
  currentData: SensorData;
  gpsHistory: [number, number][];
  status: string | null;
  incidentPoints: { latlng: [number, number]; type: string }[];
}> = ({ currentData, gpsHistory, status, incidentPoints }) => {
  const center: [number, number] = [currentData.gps_latitude, currentData.gps_longitude];
  const pathColor = status?.includes('Severe') ? '#ef4444' : status?.includes('Minor') ? '#f59e0b' : '#3b82f6';

  const incidentIcon = (type: string) => L.divIcon({
    html: `<div style="width:22px;height:22px;background:${type.includes('Severe') ? '#ef4444' : '#f59e0b'};border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
      <svg xmlns='http://www.w3.org/2000/svg' width='11' height='11' viewBox='0 0 24 24' fill='white'><path d='M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'/></svg>
    </div>`,
    className: '', iconSize: [22, 22], iconAnchor: [11, 11],
  });

  return (
    <MapContainer center={center} zoom={16} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapCenterTracker center={center} />
      {gpsHistory.length > 1 && <Polyline positions={gpsHistory} color={pathColor} weight={5} opacity={0.85} />}
      {incidentPoints.map((pt, i) => (
        <Marker key={i} position={pt.latlng} icon={incidentIcon(pt.type)}>
          <Popup><b>{pt.type} Incident</b><br />Recorded at this location</Popup>
        </Marker>
      ))}
      <Marker position={center} icon={getVehicleIcon(status)}>
        <Popup>
          <div style={{ minWidth: 160 }}>
            <b style={{ color: '#1e3a8a' }}>DL-1CA-2402</b><br />
            <span style={{ color: '#64748b', fontSize: 11 }}>New Delhi, India</span><br /><br />
            Speed: <b>{currentData.vehicle_speed} km/h</b><br />
            Vibration: <b>{currentData.vibration_level.toFixed(1)} Hz</b><br />
            Status: <b style={{ color: status?.includes('Severe') ? '#ef4444' : status?.includes('Minor') ? '#f59e0b' : '#22c55e' }}>{status || 'Normal'}</b>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
};

const SidebarItem: React.FC<{ icon: React.ReactNode; label: string; badge?: number; active?: boolean; onClick?: () => void }> = ({ icon, label, badge, active, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-2xl transition-all ${active ? 'bg-blue-50 text-blue-700 shadow-sm font-bold border border-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
    {icon}
    <span className="text-sm flex-1 text-left">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{badge}</span>
    )}
  </button>
);

const KpiCard: React.FC<{ label: string; value: string; unit?: string; icon: React.ReactNode; bgClass: string; textClass: string; trend?: number }> = ({ label, value, unit, icon, bgClass, textClass, trend }) => (
  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm relative overflow-hidden">
    <div className={`absolute -top-4 -right-4 w-20 h-20 rounded-full ${bgClass} opacity-10`}></div>
    <div className="flex items-start justify-between mb-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${bgClass} bg-opacity-10`}>{icon}</div>
      {trend !== undefined && trend !== 0 && (
        <span className={`text-[10px] font-black flex items-center gap-0.5 ${trend > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
          {trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{Math.abs(trend)}%
        </span>
      )}
    </div>
    <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider">{label}</p>
    <p className={`text-2xl font-black mt-0.5 ${textClass}`}>{value}{unit && <span className="text-xs text-slate-400 ml-1 font-normal">{unit}</span>}</p>
  </div>
);

const GaugeBar: React.FC<{ label: string; value: number; max: number; barClass: string }> = ({ label, value, max, barClass }) => {
  const pct = Math.min(100, Math.abs(value) / max * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-[10px] text-slate-400 font-black uppercase">{label}</span>
        <span className="text-[11px] font-black text-slate-600">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }}></div>
      </div>
    </div>
  );
};

const StatusDot: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <div className="flex items-center gap-2">
    <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-yellow-500'} animate-pulse`}></div>
    <span className="text-[11px] text-slate-500">{label}</span>
  </div>
);

const LoginModal: React.FC<{ isOpen: boolean; onClose: () => void; onLogin: (u: User) => void }> = ({ isOpen, onClose, onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    setTimeout(() => { onLogin({ name: 'Rajesh Kumar', email: 'r.kumar@guardianai.in' }); setLoading(false); onClose(); }, 1200);
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-md">
      <div className="w-full max-w-md bg-white border border-slate-200 p-8 rounded-[32px] shadow-2xl relative">
        <button title="Close" onClick={onClose} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-600/30 mb-4"><ShieldCheck className="text-white" size={28} /></div>
          <h2 className="text-xl font-bold text-slate-900">Access GuardianAI</h2>
          <p className="text-slate-500 text-sm mt-1">Fleet Safety System — India</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
              <input type="text" placeholder="Rajesh Kumar" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
            <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="email" placeholder="name@guardianai.in" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-9 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="password" placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-9 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50">
            {loading ? <RefreshCcw size={18} className="animate-spin" /> : <>{isLogin ? 'Sign In' : 'Create Account'}<ArrowRight size={18} /></>}
          </button>
        </form>
        <div className="mt-6 text-center">
          <button onClick={() => setIsLogin(l => !l)} className="text-sm text-slate-500 hover:text-blue-600 transition-colors">
            {isLogin ? 'New to GuardianAI? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'map' | 'news'>('dashboard');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSimulating, setIsSimulating] = useState(true);
  const [currentSensorData, setCurrentSensorData] = useState<SensorData>(generateMockData());
  const [sensorHistory, setSensorHistory] = useState<SensorData[]>([]);
  const [aiHistory, setAiHistory] = useState<HistoryItem[]>([]);
  const [lastAnalysis, setLastAnalysis] = useState<AIResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [gpsHistory, setGpsHistory] = useState<[number, number][]>([]);
  const [incidentPoints, setIncidentPoints] = useState<{ latlng: [number, number]; type: string }[]>([]);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [distanceTraveled, setDistanceTraveled] = useState(0);
  const simulationTimerRef = useRef<number | null>(null);
  const analysisTickRef = useRef(0);
  const uptime = useUptime();
  const clock = useLiveClock();

  const performAnalysis = useCallback(async (data: SensorData) => {
    setIsAnalyzing(true);
    try {
      const raw = await analyzeSafetyStatus(data);
      const accMag = Math.sqrt(data.accelerometer_x ** 2 + data.accelerometer_y ** 2 + data.accelerometer_z ** 2);
      const explanation = `Acc magnitude: ${accMag.toFixed(2)}g · Vibration: ${data.vibration_level.toFixed(1)} Hz · Speed: ${data.vehicle_speed.toFixed(1)} km/h · Gyro Z: ${data.gyroscope_z.toFixed(3)} rad/s`;
      const result: AIResponse = {
        status: raw.status as DetectionStatus,
        confidence_score: raw.confidence_score,
        recommended_action: raw.recommended_action,
        emergency_alert: raw.emergency_alert,
        explanation,
      };
      setLastAnalysis(result);
      if (result.emergency_alert) {
        setShowEmergencyModal(true);
        setTotalAlerts(n => n + 1);
        setIncidentPoints(prev => [...prev, { latlng: [data.gps_latitude, data.gps_longitude] as [number, number], type: raw.status }].slice(-20));
      } else if (raw.status === 'Minor Accident') {
        setTotalAlerts(n => n + 1);
      }
      setAiHistory(prev => [{ id: crypto.randomUUID(), data, result, timestamp: new Date().toLocaleTimeString('en-IN') }, ...prev].slice(0, 50));
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const triggerSimulationEvent = useCallback((scenario: 'normal' | 'minor' | 'severe') => {
    const data = generateMockData(scenario);
    setCurrentSensorData(data);
    setSensorHistory(prev => [...prev, data].slice(-40));
    setGpsHistory(prev => [...prev, [data.gps_latitude, data.gps_longitude] as [number, number]].slice(-120));
    performAnalysis(data);
  }, [performAnalysis]);

  useEffect(() => {
    if (isSimulating) {
      simulationTimerRef.current = window.setInterval(() => {
        const d = generateMockData('normal');
        setCurrentSensorData(d);
        setSensorHistory(prev => [...prev, d].slice(-40));
        setGpsHistory(prev => [...prev, [d.gps_latitude, d.gps_longitude] as [number, number]].slice(-120));
        setDistanceTraveled(v => parseFloat((v + 0.16).toFixed(2)));
        analysisTickRef.current += 1;
        if (analysisTickRef.current % 5 === 0) performAnalysis(d);
      }, 2000);
    } else if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }
    return () => { if (simulationTimerRef.current) clearInterval(simulationTimerRef.current); };
  }, [isSimulating, performAnalysis]);

  const generateReport = () => {
    if (!lastAnalysis || !currentSensorData) return;
    const text = `=== GuardianAI Accident Report ===\nVehicle: DL-1CA-2402 | Fleet: DL-99 | Location: New Delhi, India\n\nStatus: ${lastAnalysis.status}\nConfidence: ${lastAnalysis.confidence_score}%\nAction: ${lastAnalysis.recommended_action}\n\nSensor Data:\nAcc X/Y/Z: ${currentSensorData.accelerometer_x} / ${currentSensorData.accelerometer_y} / ${currentSensorData.accelerometer_z} g\nGyro X/Y/Z: ${currentSensorData.gyroscope_x} / ${currentSensorData.gyroscope_y} / ${currentSensorData.gyroscope_z} rad/s\nSpeed: ${currentSensorData.vehicle_speed} km/h\nVibration: ${currentSensorData.vibration_level} Hz\nGPS: ${currentSensorData.gps_latitude.toFixed(6)}, ${currentSensorData.gps_longitude.toFixed(6)}\n\nAnalysis:\n${lastAnalysis.explanation}\n\nGenerated: ${new Date().toLocaleString('en-IN')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'guardianai_report.txt'; a.click();
  };

  const statusColor = lastAnalysis?.status === DetectionStatus.Severe ? 'red'
    : lastAnalysis?.status === DetectionStatus.Minor ? 'yellow' : 'emerald';

  const chartData = sensorHistory.map((d, i) => ({
    t: i,
    vib: parseFloat(d.vibration_level.toFixed(1)),
    speed: parseFloat(d.vehicle_speed.toFixed(1)),
    accX: parseFloat(Math.abs(d.accelerometer_x).toFixed(3)),
    accY: parseFloat(Math.abs(d.accelerometer_y).toFixed(3)),
  }));

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f1f5f9] overflow-hidden text-slate-900">

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-full md:w-64 bg-white border-r border-slate-100 flex-shrink-0 z-20 flex flex-col p-5 shadow-sm">
        <div className="flex items-center space-x-3 mb-8 pl-1">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30">
            <ShieldCheck className="text-white" size={22} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-slate-900">GuardianAI</h1>
            <span className="text-[9px] text-blue-600 font-black uppercase tracking-widest">DL Fleet Unit 99</span>
          </div>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 mb-5 border border-slate-100 space-y-2">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">System Status</p>
          <StatusDot ok={true} label="IoT Sensors Active" />
          <StatusDot ok={true} label="AI Engine Running" />
          <StatusDot ok={true} label="GPS Tracking" />
          <StatusDot ok={totalAlerts < 3} label="Incident Monitor" />
        </div>

        <nav className="space-y-1 flex-1">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-4 pb-1 pt-1">Navigation</p>
          <SidebarItem icon={<Activity size={18} />} label="Overview Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={<MapIcon size={18} />} label="Real-time Tracking" active={activeTab === 'map'} onClick={() => setActiveTab('map')} />
          <SidebarItem icon={<Newspaper size={18} />} label="Safety Bulletin" active={activeTab === 'news'} badge={MOCK_NEWS.filter(n => n.category === 'NEWS').length} onClick={() => setActiveTab('news')} />
          <div className="pt-3 pb-1">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-4">Administrative</p>
          </div>
          <SidebarItem icon={<History size={18} />} label="Incident Logs" badge={totalAlerts} onClick={() => currentUser ? alert(`${aiHistory.length} events logged`) : setIsAuthModalOpen(true)} />
        </nav>

        <div className="my-4 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-2.5">
          <Clock className="text-slate-400 flex-shrink-0" size={14} />
          <div>
            <p className="text-[9px] text-slate-400 font-black uppercase">Session Uptime</p>
            <p className="text-sm font-black text-slate-800 font-mono">{uptime}</p>
          </div>
        </div>

        {currentUser ? (
          <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100 flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black text-xs">
              {currentUser.name.split(' ').map((n: string) => n[0]).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 truncate">{currentUser.name}</p>
              <button onClick={() => setCurrentUser(null)} className="text-[10px] text-red-500 font-bold hover:underline">Sign Out</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setIsAuthModalOpen(true)} className="w-full py-3 bg-slate-900 text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-800 transition-all text-sm">
            <UserIcon size={16} /> Account Login
          </button>
        )}
      </aside>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto h-screen">
        <header className="sticky top-0 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-8 py-4 flex items-center justify-between z-10 shadow-sm">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              System Monitoring
              <span className="text-[9px] px-2 py-1 bg-blue-50 text-blue-700 rounded-lg font-black border border-blue-100 uppercase tracking-wider">DL-1CA-2402</span>
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[2px]">New Delhi, India · {clock}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-100">
              <Radio size={12} className="text-blue-500 animate-pulse" />
              <span className="text-[10px] font-black text-slate-500 uppercase">LTE-M · 98%</span>
            </div>
            <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 transition-all ${
              statusColor === 'red' ? 'bg-red-50 border-red-200 text-red-700' :
              statusColor === 'yellow' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
              'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              <div className={`w-2 h-2 rounded-full animate-pulse ${statusColor === 'red' ? 'bg-red-500' : statusColor === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[10px] font-black uppercase tracking-wider">{lastAnalysis?.status || 'All Systems Nominal'}</span>
            </div>
          </div>
        </header>

        <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">

          {/* ══ DASHBOARD ══════════════════════════════════════════════ */}
          {activeTab === 'dashboard' && (
            <>
              {/* KPI Row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="Total Alerts Today" value={String(totalAlerts)} icon={<AlertTriangle size={17} className="text-red-500" />} bgClass="bg-red-500" textClass="text-red-600" trend={totalAlerts > 0 ? 12 : undefined} />
                <KpiCard label="Current Speed" value={currentSensorData.vehicle_speed.toFixed(1)} unit="km/h" icon={<Car size={17} className="text-blue-500" />} bgClass="bg-blue-500" textClass="text-blue-700" />
                <KpiCard label="Distance Traveled" value={distanceTraveled.toFixed(2)} unit="km" icon={<Navigation size={17} className="text-emerald-500" />} bgClass="bg-emerald-500" textClass="text-emerald-700" trend={-3} />
                <KpiCard label="AI Confidence" value={lastAnalysis ? String(lastAnalysis.confidence_score) : '—'} unit="%" icon={<ShieldCheck size={17} className="text-purple-500" />} bgClass="bg-purple-500" textClass="text-purple-700" />
              </div>

              {/* Row 2: Scenario Controls + Sensor Gauges */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 lg:col-span-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">Scenario Injection</h3>
                    <div className="ml-auto flex items-center gap-2">
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase border ${isSimulating ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {isSimulating ? '● Live' : '○ Paused'}
                      </span>
                      <button onClick={() => setIsSimulating(s => !s)} className="text-[9px] font-black px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 uppercase transition-all border border-slate-200">
                        {isSimulating ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mb-5">Inject synthetic IoT sensor data to test the ML classification pipeline.</p>
                  <div className="grid grid-cols-3 gap-4">
                    {([
                      { s: 'normal' as const, label: 'Normal Drive', sub: 'Smooth road, no events', icon: <CheckCircle size={22} />, hover: 'hover:border-emerald-300', hBg: 'group-hover:bg-emerald-600' },
                      { s: 'minor' as const, label: 'Minor Impact', sub: 'Pothole / speed bump', icon: <AlertCircle size={22} />, hover: 'hover:border-yellow-300', hBg: 'group-hover:bg-yellow-500' },
                      { s: 'severe' as const, label: 'Collision', sub: 'High-G impact event', icon: <AlertTriangle size={22} />, hover: 'hover:border-red-300', hBg: 'group-hover:bg-red-600' },
                    ]).map(({ s, label, sub, icon, hover, hBg }) => (
                      <button key={s} onClick={() => triggerSimulationEvent(s)}
                        className={`flex flex-col items-center gap-2.5 p-5 bg-slate-50 rounded-2xl border border-slate-200 ${hover} hover:bg-white hover:shadow-lg transition-all group`}>
                        <div className={`w-11 h-11 bg-white rounded-xl flex items-center justify-center shadow-sm text-slate-500 ${hBg} group-hover:text-white transition-all`}>{icon}</div>
                        <span className="text-xs font-black text-slate-700 text-center">{label}</span>
                        <span className="text-[9px] text-slate-400 text-center leading-tight">{sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <Activity size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">Live Sensor Readings</h3>
                  </div>
                  <div className="space-y-3.5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Accelerometer (g)</p>
                    <GaugeBar label="X" value={currentSensorData.accelerometer_x} max={1.5} barClass="bg-blue-500" />
                    <GaugeBar label="Y" value={currentSensorData.accelerometer_y} max={1.5} barClass="bg-indigo-500" />
                    <GaugeBar label="Z" value={currentSensorData.accelerometer_z} max={1.5} barClass="bg-violet-500" />
                    <div className="border-t border-slate-50 pt-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Gyroscope (rad/s)</p>
                      <GaugeBar label="X" value={currentSensorData.gyroscope_x} max={40} barClass="bg-cyan-500" />
                      <div className="mt-2"><GaugeBar label="Y" value={currentSensorData.gyroscope_y} max={40} barClass="bg-teal-500" /></div>
                      <div className="mt-2"><GaugeBar label="Z" value={currentSensorData.gyroscope_z} max={40} barClass="bg-emerald-500" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="p-3 bg-orange-50 rounded-xl text-center border border-orange-100">
                        <Thermometer size={13} className="text-orange-500 mx-auto mb-1" />
                        <p className="text-[9px] text-slate-400 font-black uppercase">Engine</p>
                        <p className="text-sm font-black text-orange-600">82°C</p>
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-xl text-center border border-emerald-100">
                        <Battery size={13} className="text-emerald-500 mx-auto mb-1" />
                        <p className="text-[9px] text-slate-400 font-black uppercase">Battery</p>
                        <p className="text-sm font-black text-emerald-600">94%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Chart + AI Insight */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 lg:col-span-3">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">Live Telemetry Stream</h3>
                    <span className="ml-auto text-[9px] text-slate-400">{sensorHistory.length} readings</span>
                  </div>
                  <div className="flex flex-wrap gap-4 mb-4">
                    {[['Vibration (Hz)', '#3b82f6'], ['Speed (km/h)', '#10b981'], ['|Acc X| (g)', '#8b5cf6'], ['|Acc Y| (g)', '#f59e0b']].map(([lbl, col]) => (
                      <div key={lbl} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ background: col }}></div>
                        <span className="text-[10px] text-slate-500">{lbl}</span>
                      </div>
                    ))}
                  </div>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="t" hide />
                        <YAxis stroke="#94a3b8" fontSize={9} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '12px', boxShadow: '0 8px 20px rgba(0,0,0,0.06)', fontSize: 11 }} />
                        <Line type="monotone" dataKey="vib" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Vibration" />
                        <Line type="monotone" dataKey="speed" stroke="#10b981" strokeWidth={2} dot={false} name="Speed" />
                        <Line type="monotone" dataKey="accX" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="|Acc X|" />
                        <Line type="monotone" dataKey="accY" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="|Acc Y|" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-4">
                    {[
                      { lbl: 'Velocity', v: currentSensorData.vehicle_speed.toFixed(1), u: 'km/h', c: 'text-blue-700' },
                      { lbl: 'Vibration', v: currentSensorData.vibration_level.toFixed(1), u: 'Hz', c: 'text-indigo-700' },
                      { lbl: 'G-Force', v: (Math.sqrt(currentSensorData.accelerometer_x**2+currentSensorData.accelerometer_y**2+currentSensorData.accelerometer_z**2)+1).toFixed(2), u: 'G', c: 'text-violet-700' },
                      { lbl: 'Confidence', v: lastAnalysis ? String(lastAnalysis.confidence_score) : '—', u: '%', c: 'text-emerald-700' },
                    ].map(m => (
                      <div key={m.lbl} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                        <p className="text-[9px] text-slate-400 font-black uppercase">{m.lbl}</p>
                        <p className={`text-xl font-black ${m.c}`}>{m.v}<span className="text-[10px] text-slate-400 ml-0.5">{m.u}</span></p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col">
                  <div className="flex items-center gap-2 mb-4">
                    <ShieldCheck size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">AI Insight</h3>
                    {isAnalyzing && <RefreshCcw size={12} className="text-blue-400 animate-spin ml-auto" />}
                  </div>
                  {isAnalyzing ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                      <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-3 border border-blue-100">
                        <RefreshCcw className="text-blue-500 animate-spin" size={22} />
                      </div>
                      <p className="text-xs text-slate-400 font-bold uppercase">Analysing...</p>
                    </div>
                  ) : lastAnalysis ? (
                    <div className="flex-1 flex flex-col space-y-3">
                      <div className={`p-3.5 rounded-xl border flex items-center justify-between ${statusColor === 'red' ? 'bg-red-50 border-red-200' : statusColor === 'yellow' ? 'bg-yellow-50 border-yellow-200' : 'bg-emerald-50 border-emerald-200'}`}>
                        <span className="text-[9px] font-black uppercase text-slate-500">Status</span>
                        <span className={`text-sm font-black ${statusColor === 'red' ? 'text-red-700' : statusColor === 'yellow' ? 'text-yellow-700' : 'text-emerald-700'}`}>{lastAnalysis.status}</span>
                      </div>
                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-1">Action</p>
                        <p className="text-xs text-slate-700 font-medium leading-relaxed">"{lastAnalysis.recommended_action}"</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-1">Analysis</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{lastAnalysis.explanation}</p>
                      </div>
                      {aiHistory.length > 0 && (
                        <div className="flex-1">
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-1.5">Recent Events</p>
                          <div className="space-y-1.5 max-h-24 overflow-y-auto">
                            {aiHistory.slice(0, 4).map(h => (
                              <div key={h.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${h.result.status === DetectionStatus.Severe ? 'bg-red-500' : h.result.status === DetectionStatus.Minor ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
                                <span className="text-[9px] text-slate-500 flex-1 truncate">{h.result.status}</span>
                                <span className="text-[9px] text-slate-400">{h.timestamp}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <button onClick={generateReport} className="mt-1 w-full py-3 bg-slate-900 text-white text-[10px] font-black uppercase rounded-xl hover:bg-slate-800 transition-all tracking-wider">
                        Download Report
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                      <Activity className="text-slate-200 mb-3" size={32} />
                      <p className="text-sm text-slate-400 font-medium">Awaiting events...</p>
                      <p className="text-[10px] text-slate-300 mt-1">Trigger a scenario above</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 4: Vibration bars + Bulletins */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">Vibration History</h3>
                  </div>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData.slice(-15)} barSize={8}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
                        <XAxis dataKey="t" hide />
                        <YAxis fontSize={9} axisLine={false} tickLine={false} stroke="#94a3b8" />
                        <Tooltip contentStyle={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '10px', fontSize: 11 }} />
                        <Bar dataKey="vib" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Vibration (Hz)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Newspaper size={16} className="text-blue-500" />
                    <h3 className="font-bold text-slate-800">Safety Bulletins</h3>
                  </div>
                  <div className="space-y-3">
                    {MOCK_NEWS.slice(0, 3).map(item => (
                      <div key={item.id} className="flex items-start gap-3 p-3 hover:bg-slate-50 rounded-xl transition-all cursor-pointer">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.category === 'NEWS' ? 'bg-blue-50 text-blue-600' : item.category === 'SYSTEM' ? 'bg-purple-50 text-purple-600' : 'bg-emerald-50 text-emerald-600'}`}>
                          {item.category === 'NEWS' ? <Newspaper size={14} /> : item.category === 'SYSTEM' ? <Settings size={14} /> : <CheckCircle size={14} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{item.content}</p>
                        </div>
                        <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{item.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ══ REAL-TIME TRACKING ═══════════════════════════════════ */}
          {activeTab === 'map' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-1.5">Speed</p>
                  <p className="text-2xl font-black text-blue-700">{currentSensorData.vehicle_speed.toFixed(1)}<span className="text-xs text-slate-400 ml-1">km/h</span></p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-1.5">Vibration</p>
                  <p className="text-2xl font-black text-slate-700">{currentSensorData.vibration_level.toFixed(1)}<span className="text-xs text-slate-400 ml-1">Hz</span></p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-1.5">G-Force</p>
                  <p className="text-2xl font-black text-slate-700">{(Math.sqrt(currentSensorData.accelerometer_x**2+currentSensorData.accelerometer_y**2+currentSensorData.accelerometer_z**2)+1).toFixed(2)}<span className="text-xs text-slate-400 ml-1">G</span></p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-1.5">Distance</p>
                  <p className="text-2xl font-black text-emerald-600">{distanceTraveled.toFixed(2)}<span className="text-xs text-slate-400 ml-1">km</span></p>
                </div>
                <div className={`rounded-2xl p-4 border shadow-sm ${statusColor === 'red' ? 'bg-red-50 border-red-200' : statusColor === 'yellow' ? 'bg-yellow-50 border-yellow-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-1.5">AI Status</p>
                  <p className={`text-sm font-black leading-tight ${statusColor === 'red' ? 'text-red-700' : statusColor === 'yellow' ? 'text-yellow-700' : 'text-emerald-700'}`}>{lastAnalysis?.status || 'Normal Driving'}</p>
                </div>
              </div>

              {/* Map */}
              <div className="bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm" style={{ height: '500px' }}>
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-white">
                  <MapIcon size={15} className="text-blue-500" />
                  <span className="font-bold text-slate-800 text-sm">Live Vehicle Location — New Delhi, India</span>
                  <div className="ml-auto flex items-center gap-4 text-[10px] font-black text-slate-500 uppercase">
                    <span className="flex items-center gap-1"><div className="w-3 h-1 bg-blue-500 rounded"></div>Route</span>
                    <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 bg-red-400 rounded-full"></div>Incident</span>
                    <div className="flex items-center gap-1 text-emerald-600"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>GPS Active</div>
                  </div>
                </div>
                <div style={{ height: 'calc(100% - 49px)' }}>
                  <VehicleMap currentData={currentSensorData} gpsHistory={gpsHistory} status={lastAnalysis?.status || null} incidentPoints={incidentPoints} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Navigation size={15} className="text-blue-500" />
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">GPS Telemetry</span>
                    <Wifi size={11} className="text-emerald-500 ml-auto animate-pulse" />
                  </div>
                  <p className="font-mono text-sm font-black text-slate-900">{currentSensorData.gps_latitude.toFixed(6)}</p>
                  <p className="font-mono text-sm font-black text-slate-900">{currentSensorData.gps_longitude.toFixed(6)}</p>
                  <p className="text-[10px] text-slate-400 mt-1 mb-3">New Delhi, India</p>
                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-50 pt-3">
                    <div><p className="text-[9px] text-slate-400 uppercase font-black">Waypoints</p><p className="font-black text-slate-700">{gpsHistory.length}</p></div>
                    <div><p className="text-[9px] text-slate-400 uppercase font-black">Incidents</p><p className="font-black text-red-600">{incidentPoints.length}</p></div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={15} className="text-blue-500" />
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Gyroscope (rad/s)</span>
                  </div>
                  <div className="space-y-3">
                    <GaugeBar label="X axis" value={currentSensorData.gyroscope_x} max={40} barClass="bg-blue-500" />
                    <GaugeBar label="Y axis" value={currentSensorData.gyroscope_y} max={40} barClass="bg-indigo-500" />
                    <GaugeBar label="Z axis" value={currentSensorData.gyroscope_z} max={40} barClass="bg-violet-500" />
                  </div>
                  <div className="mt-4 border-t border-slate-50 pt-3">
                    <p className="text-[9px] text-slate-400 font-black uppercase mb-2">Accelerometer (g)</p>
                    <div className="space-y-2">
                      <GaugeBar label="X" value={currentSensorData.accelerometer_x} max={1.5} barClass="bg-cyan-500" />
                      <GaugeBar label="Y" value={currentSensorData.accelerometer_y} max={1.5} barClass="bg-teal-500" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle size={15} className="text-red-500" />
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Incident Markers</span>
                    <span className="ml-auto text-[9px] bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-lg font-black">{incidentPoints.length}</span>
                  </div>
                  {incidentPoints.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <CheckCircle className="text-emerald-300 mb-2" size={28} />
                      <p className="text-xs text-slate-400 font-medium">No incidents recorded</p>
                      <p className="text-[10px] text-slate-300 mt-0.5">Route is safe</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto">
                      {incidentPoints.map((pt, i) => (
                        <div key={i} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pt.type.includes('Severe') ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
                          <span className="text-[10px] font-bold text-slate-700 flex-1">{pt.type}</span>
                          <span className="text-[9px] text-slate-400 font-mono">{pt.latlng[0].toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ SAFETY BULLETIN ══════════════════════════════════════ */}
          {activeTab === 'news' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {MOCK_NEWS.map(n => (
                <div key={n.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 hover:shadow-lg transition-all">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`text-[9px] px-2.5 py-1 rounded-lg font-black uppercase tracking-widest border ${n.category === 'NEWS' ? 'bg-blue-50 text-blue-700 border-blue-100' : n.category === 'SYSTEM' ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>{n.category}</span>
                    <span className="text-[9px] text-slate-400 font-bold ml-auto">{n.date}</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 mb-2">{n.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed mb-4">{n.content}</p>
                  <button className="text-blue-600 text-[10px] font-black uppercase flex items-center gap-1 hover:gap-2 transition-all">Read More <ChevronRight size={12} /></button>
                </div>
              ))}
            </div>
          )}

        </div>
      </main>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <LoginModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onLogin={setCurrentUser} />

      {showEmergencyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xl">
          <div className="bg-white border-2 border-red-300 rounded-[32px] max-w-md w-full p-8 shadow-[0_0_80px_rgba(239,68,68,0.35)]">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="relative flex items-center justify-center">
                <div className="w-20 h-20 bg-red-100 rounded-full absolute animate-ping opacity-40"></div>
                <div className="w-20 h-20 bg-red-600 rounded-3xl flex items-center justify-center shadow-xl shadow-red-600/40 relative">
                  <AlertTriangle size={38} className="text-white" />
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-2">Critical Event Detected</div>
                <h2 className="text-2xl font-black text-slate-900 mb-2">Severe Collision Pattern</h2>
                <p className="text-xs text-slate-500 leading-relaxed">High-G acceleration detected. AI confidence: {lastAnalysis?.confidence_score}%</p>
                <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-xs text-slate-700 font-medium">"{lastAnalysis?.recommended_action}"</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full">
                <button onClick={() => setShowEmergencyModal(false)} className="py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-black rounded-2xl transition-all text-xs uppercase tracking-widest">False Alarm</button>
                <button className="py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-2xl shadow-lg shadow-red-600/30 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-widest">
                  📞 Call 112
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
