import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DialogProvider } from './context/DialogContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DialogProvider>
    </ErrorBoundary>
  </StrictMode>,
)
