import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import ErrorBoundary from "@/components/ui/ErrorBoundary";
const SalonApp = lazy(() => import("./SalonApp"));
const PlatformApp = lazy(() => import("./platform/PlatformApp"));

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Routes>
          <Route path="/platform/*" element={<PlatformApp />} />
          <Route path="*" element={<SalonApp />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
