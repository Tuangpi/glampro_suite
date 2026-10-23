import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRoutes } from "react-router";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/contexts/AuthContext";
import { SalonFormattingProvider } from "@/contexts/SalonFormattingContext";
import routes from "@/routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

function SalonRoutes() {
  return useRoutes(routes);
}

export default function SalonApp() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Salon providers never mount on platform routes. */}
      <AuthProvider>
        <ToastProvider>
          <SalonFormattingProvider>
            <SalonRoutes />
          </SalonFormattingProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
