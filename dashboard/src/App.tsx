import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Activity, 
  Wallet, 
  ShieldCheck, 
  TrendingUp, 
  List, 
  Terminal, 
  AlertTriangle,
  Zap,
  LayoutDashboard,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Dashboard Component ---
const App = () => {
  const [events, setEvents] = useState([]);
  const [positions, setPositions] = useState([]);
  const [stats, setStats] = useState({
    winRate: 0,
    totalTrades: 0,
    totalProfit: 0,
    activePositions: 0
  });
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const socket = io('http://localhost:3001');

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    
    socket.on('history', (history) => {
      setEvents(history);
    });

    socket.on('event', (event) => {
      setEvents(prev => [event, ...prev].slice(0, 50));
    });

    return () => socket.disconnect();
  }, []);

  return (
    <div className="min-h-screen p-6 bg-background text-white selection:bg-neon/30">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight neon-glow flex items-center gap-3">
            <Zap className="text-neon fill-neon/20" size={32} />
            SNIPER<span className="text-accent">BOT</span> PRO
          </h1>
          <p className="text-gray-400 text-sm mt-1 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-danger'}`} />
            {connected ? 'Real-time Bridge Active' : 'Disconnected from Bot'}
          </p>
        </div>
        
        <div className="flex gap-4">
          <div className="glass-card px-4 py-2 flex items-center gap-3">
            <Clock className="text-accent" size={18} />
            <span className="font-mono text-sm">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </header>

      {/* Grid Layout */}
      <div className="grid grid-cols-12 gap-6">
        
        {/* Stats Column */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <StatCard title="Win Rate" value={`${stats.winRate}%`} icon={<TrendingUp className="text-success" />} />
          <StatCard title="Total P&L" value={`+${stats.totalProfit} SOL`} icon={<Zap className="text-neon" />} />
          <StatCard title="Active Trades" value={stats.activePositions} icon={<Activity className="text-accent" />} />
          
          <div className="glass-card p-5 h-[300px]">
            <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
              <Wallet size={16} /> WALLET STATUS
            </h3>
            <div className="space-y-6">
              <WalletGauge label="Signer" balance="0.00" color="#00f2ff" />
              <WalletGauge label="Vault" balance="0.00" color="#0066ff" />
            </div>
          </div>
        </div>

        {/* Main Feed Column */}
        <div className="col-span-12 lg:col-span-6 space-y-6">
          <div className="glass-card p-5 h-[500px] flex flex-col">
            <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
              <Terminal size={16} /> LIVE INTELLIGENCE FEED
            </h3>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
              <AnimatePresence initial={false}>
                {events.map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 bg-white/5 rounded-lg border border-white/5 text-sm font-mono flex gap-3"
                  >
                    <span className="text-gray-500 whitespace-nowrap">{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                    <span className={getEventColor(event.data.level)}>{event.data.msg}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
              <LayoutDashboard size={16} /> ACTIVE POSITIONS
            </h3>
            <div className="text-center py-8 text-gray-500">
              No active positions. Monitoring market...
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
              <ShieldCheck size={16} /> SAFETY MATRIX
            </h3>
            <div className="space-y-4">
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="text-xs text-gray-500 mb-1">CURRENT TIER</div>
                <div className="text-lg font-bold text-success">STANDARD</div>
              </div>
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="text-xs text-gray-500 mb-1">RUGCHECK STATUS</div>
                <div className="text-sm text-neon">API CONNECTION ACTIVE</div>
              </div>
            </div>
          </div>

          <div className="glass-card p-5 h-[400px]">
             <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
              <AlertTriangle size={16} /> CRITICAL LOGS
            </h3>
            <div className="space-y-2">
              {events.filter(e => e.data.level === 'error' || e.data.level === 'warn').map(e => (
                <div key={e.id} className="p-2 bg-danger/10 border border-danger/20 rounded text-xs text-danger">
                   {e.data.msg}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

// --- Helper Components ---

const StatCard = ({ title, value, icon }) => (
  <div className="glass-card p-5 flex items-center justify-between group cursor-default hover:border-neon/30 transition-all">
    <div>
      <p className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wider">{title}</p>
      <h2 className="text-2xl font-bold text-white group-hover:neon-glow transition-all">{value}</h2>
    </div>
    <div className="p-3 bg-white/5 rounded-xl group-hover:bg-white/10 transition-colors">
      {icon}
    </div>
  </div>
);

const WalletGauge = ({ label, balance, color }) => (
  <div>
    <div className="flex justify-between items-end mb-2">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm font-mono font-bold" style={{ color }}>{balance} SOL</span>
    </div>
    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
      <div 
        className="h-full rounded-full transition-all duration-1000" 
        style={{ width: '0%', backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      />
    </div>
  </div>
);

const getEventColor = (level) => {
  switch (level) {
    case 'success': return 'text-success';
    case 'error': return 'text-danger font-bold';
    case 'warn': return 'text-warning';
    case 'snipe': return 'text-neon font-bold';
    case 'trade': return 'text-accent';
    default: return 'text-gray-300';
  }
};

export default App;
