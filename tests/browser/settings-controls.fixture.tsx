import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsRadioGroup } from '@/components/settings/ui/SettingsRadioGroup';
import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch';

const options = [
  { value: 'a', label: 'Alpha', description: 'First' },
  { value: 'b', label: 'Beta', description: 'Second' },
  { value: 'c', label: 'Gamma', description: 'Third' },
];
function Fixture() {
  const [value, setValue] = useState('a');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<string[]>([]);
  const [on, setOn] = useState(false);
  const [pending, setPending] = useState(false);
  return <div className="mx-auto max-w-xl space-y-6 p-6">
    <button type="button" onClick={() => setBusy((current) => !current)}>toggle busy</button>
    <SettingsRadioGroup label="Pick one" value={value} busy={busy} options={options} testIdPrefix="pick" onValueChange={(next) => { setChanges((current) => [...current, next]); setValue(next); }} />
    <output data-testid="changes">{changes.join(',')}</output>
    <button type="button" onClick={() => setPending((current) => !current)}>toggle pending</button>
    <SettingsSwitch showLabel aria-label="Email" checked={on} pending={pending} onCheckedChange={setOn} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
