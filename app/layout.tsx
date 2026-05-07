import Sidebar from "./components/Sidebar";

export const metadata = {
  title: "Nava Strat",
  description: "Fleet Intelligence Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          display: "flex",
          backgroundColor: "#f8fafc",
        }}
      >
        {/* Persistent Navigation */}
        <Sidebar />

        {/* Responsive Content Area */}
        <main
          style={{
            marginLeft: 240,
            width: "calc(100% - 240px)",
            minHeight: "100vh",
            boxSizing: "border-box",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
