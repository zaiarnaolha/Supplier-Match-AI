import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage/LandingPage';
import { CompareScreen } from './pages/CompareScreen/CompareScreen';
import { SupplierSearchPage, type SearchStage } from './pages/SupplierSearchPage/SupplierSearchPage';
import { SupplierDetailsPage } from './pages/SupplierDetailsPage/SupplierDetailsPage';

export function App() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<SearchStage>('idle');
  const [deliveryRegion, setDeliveryRegion] = useState('');
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [showCompareLimit, setShowCompareLimit] = useState(false);

  const searchState = {
    query, setQuery, stage, setStage, deliveryRegion, setDeliveryRegion,
    selectedSuppliers, setSelectedSuppliers, showCompareLimit, setShowCompareLimit,
  };

  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/app" element={<SupplierSearchPage {...searchState} />} />
    <Route path="/app/suppliers/:id" element={<SupplierDetailsPage />} />
    <Route path="/app/compare" element={selectedSuppliers.length >= 2
      ? <CompareScreen selectedSupplierNames={selectedSuppliers} setSelectedSupplierNames={setSelectedSuppliers} />
      : <Navigate to="/app" replace />} />
  </Routes>;
}
