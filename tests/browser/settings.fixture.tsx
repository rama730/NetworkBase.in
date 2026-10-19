import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsLayout from '@/components/settings/SettingsLayout';
import SettingsDocument from '@/components/settings/SettingsDocument';

const fixture=(window as any).settingsFixture={
  refresh:()=>{},
  navigate(href:string,replace=false){window.history[replace?'replaceState':'pushState']({__NA:true},'',href);fixture.refresh();},
};
function Fixture(){
  const [,refresh]=useState(0);
  useEffect(()=>{
    fixture.refresh=()=>refresh(value=>value+1);
    window.addEventListener('popstate',fixture.refresh);
    return()=>window.removeEventListener('popstate',fixture.refresh);
  },[]);
  return <div className="flex h-dvh flex-col"><header className="h-14 shrink-0">NetworkBase</header><div className="flex min-h-0 flex-1"><nav aria-label="Application navigation" className="hidden shrink-0 border-r border-border px-3 py-4 lg:block" style={{width:'var(--nb-sidebar-width)'}}><div className="pr-1"><a className="nb-nav-link" href="/settings">Settings</a></div></nav><div className="min-h-0 min-w-0 flex-1"><SettingsLayout><SettingsDocument /></SettingsLayout></div></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
