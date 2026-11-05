import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { Toaster } from 'sonner'
import './components/floating-notice.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="top-center" closeButton duration={7000} className="app-messages" toastOptions={{className:"app-message",closeButtonAriaLabel:"关闭提示"}}/>
    </BrowserRouter>
  </StrictMode>,
)
