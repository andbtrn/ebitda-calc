import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community'
import 'sweetalert2/dist/sweetalert2.min.css'
import App from './App'
import './styles.css'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
