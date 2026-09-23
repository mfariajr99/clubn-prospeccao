import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EmptyState, SkeletonRows } from "./components/ui";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const LeadsList = lazy(() => import("./pages/LeadsList"));
const LeadForm = lazy(() => import("./pages/LeadForm"));
const LeadDetail = lazy(() => import("./pages/LeadDetail"));
const ImportProspects = lazy(() => import("./pages/ImportProspects"));
const CampaignsList = lazy(() => import("./pages/CampaignsList"));
const CampaignForm = lazy(() => import("./pages/CampaignForm"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const CampaignStart = lazy(() => import("./pages/CampaignStart"));

export default function App() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads" element={<LeadsList />} />
          <Route path="leads/novo" element={<LeadForm />} />
          <Route path="leads/importar" element={<ImportProspects />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="leads/:id/editar" element={<LeadForm />} />
          <Route path="campanhas" element={<CampaignsList />} />
          <Route path="campanhas/nova" element={<CampaignForm />} />
          <Route path="campanhas/iniciar" element={<CampaignStart />} />
          <Route path="campanhas/iniciar/:id" element={<CampaignStart />} />
          <Route path="campanhas/:id" element={<CampaignDetail />} />
          <Route path="campanhas/:id/editar" element={<CampaignForm />} />
          <Route path="*" element={<EmptyState title="Página não encontrada" action={<Link className="btn sm" to="/">Ir para a visão geral</Link>} />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
