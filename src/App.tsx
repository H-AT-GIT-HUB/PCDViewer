import React, { useState } from 'react';
import PCDViewer from './components/PCDViewer';
import { Upload } from 'lucide-react';

export default function App() {
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setFileUrl(url);
    }
  };

  return (
    <div className="w-full h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900 z-10">
        <h1 className="text-xl font-semibold tracking-tight">PCD Viewer</h1>
        <div>
          <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-md cursor-pointer transition-colors text-sm font-medium">
            <Upload size={16} />
            Open Local .pcd File
            <input 
              type="file" 
              accept=".pcd" 
              className="hidden" 
              onChange={handleFileUpload} 
            />
          </label>
        </div>
      </header>
      
      <main className="flex-1 relative overflow-hidden">
        {fileUrl ? (
          <PCDViewer url={fileUrl} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
            <Upload size={48} className="mb-4 opacity-50" />
            <p className="text-lg">Select a .pcd file to preview</p>
          </div>
        )}
      </main>
    </div>
  );
}
