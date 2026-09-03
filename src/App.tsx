import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage/LandingPage';
import { CompareScreen } from './pages/CompareScreen/CompareScreen';
import { SupplierSearchPage, type SearchStage } from './pages/SupplierSearchPage/SupplierSearchPage';
import { SupplierDetailsPage } from './pages/SupplierDetailsPage/SupplierDetailsPage';
import type { Supplier } from './data/suppliers';

export function App() {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<SearchStage>('idle');
  const [deliveryRegion, setDeliveryRegion] = useState('');
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [showCompareLimit, setShowCompareLimit] = useState(false);
  const [searchResults, setSearchResults] = useState<Supplier[]>([]);

  const searchState = {
    query, setQuery, stage, setStage, deliveryRegion, setDeliveryRegion,
    selectedSuppliers, setSelectedSuppliers, showCompareLimit, setShowCompareLimit,
    searchResults, setSearchResults,
  };

  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/app" element={<SupplierSearchPage {...searchState} />} />
    <Route path="/app/suppliers/:id" element={<SupplierDetailsPage suppliers={searchResults} />} />
    <Route path="/app/compare" element={selectedSuppliers.length >= 2
      ? <CompareScreen suppliers={searchResults} selectedSupplierNames={selectedSuppliers} setSelectedSupplierNames={setSelectedSuppliers} />
      : <Navigate to="/app" replace />} />
  </Routes>;
}
