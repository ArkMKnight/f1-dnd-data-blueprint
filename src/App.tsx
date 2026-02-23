import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import TeamListPage from "./pages/TeamListPage";
import TeamFormPage from "./pages/TeamFormPage";
import DriverListPage from "./pages/DriverListPage";
import DriverFormPage from "./pages/DriverFormPage";
import { DataProvider } from "./context/DataContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <DataProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/teams" element={<TeamListPage />} />
            <Route path="/teams/new" element={<TeamFormPage />} />
            <Route path="/teams/:id/edit" element={<TeamFormPage />} />
            <Route path="/drivers" element={<DriverListPage />} />
            <Route path="/drivers/new" element={<DriverFormPage />} />
            <Route path="/drivers/:id/edit" element={<DriverFormPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </DataProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
