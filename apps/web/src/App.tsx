import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

import ErrorBoundary from "@/components/ui/ErrorBoundary";
import PageLoading from "@/components/ui/PageLoading";
const SalonApp = lazy(() => import("./SalonApp"));
const PlatformApp = lazy(() => import("./platform/PlatformApp"));

function App() {
  return (
    <ErrorBoundary>
      {/* The application's own loading screen, not a bare sentence: this is the first
          thing painted on a cold start, and a line of unstyled text in the corner reads
          as a broken page rather than a slow one. */}
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/platform/*" element={<PlatformApp />} />
          <Route path="*" element={<SalonApp />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
