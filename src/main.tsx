import ReactDOM from 'react-dom/client';
import { App } from './App';
import { studio } from './store';
import '@xyflow/react/dist/style.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
void studio.initialize();
document.addEventListener('visibilitychange', () => { if (document.hidden) void studio.flush().catch(() => {}); });
window.addEventListener('beforeunload', e => { if (studio.isDirty) { void studio.flush().catch(() => {}); e.preventDefault(); } });
