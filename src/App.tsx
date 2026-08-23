import { Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage/LandingPage';
import { SupplierSearchPage } from './pages/SupplierSearchPage/SupplierSearchPage';

export function App(){return <Routes><Route path="/" element={<LandingPage/>}/><Route path="/app/*" element={<SupplierSearchPage/>}/></Routes>}
