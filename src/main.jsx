import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { isWindowsPlatform } from './lib/platformUtils.js'
import { cleanupLegacyServiceWorkerAndCaches } from './lib/legacyServiceWorkerCleanup.js'
import { requestPersistentBrowserStorage } from './lib/durableBrowserStorage.js'
import './styles/index.css'
import './styles/components.css'
import './styles/calendar.css'
import './styles/shockwave.css'
import './styles/pt_stats.css'
import './styles/mobile.css'

if (typeof document !== 'undefined' && isWindowsPlatform()) {
  document.documentElement.classList.add('platform-windows')
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void cleanupLegacyServiceWorkerAndCaches(window)
  });
}

if (typeof window !== 'undefined') {
  void requestPersistentBrowserStorage(window)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
