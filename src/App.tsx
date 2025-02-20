import { BrowserRouter, Route, Routes } from 'react-router-dom';
import TraderSyncDashboard from './TraderSyncDashboard';
import './App.css'

function App() {

  return (
    <>
      <BrowserRouter>
        <Routes>

          <Route path="/" element={<TraderSyncDashboard />} >
          </Route>

        </Routes>

      </BrowserRouter>
    </>
  )
}

export default App
