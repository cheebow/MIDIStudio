// Help window (ADR-054): a section list on the left, the chosen section on the right.
import { useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { HELP_SECTIONS } from './content';

export function HelpDialog({ section = 'start', onClose }: { section?: string; onClose: () => void }) {
  const [current, setCurrent] = useState(HELP_SECTIONS.some((s) => s.id === section) ? section : 'start');
  const active = HELP_SECTIONS.find((s) => s.id === current) ?? HELP_SECTIONS[0];
  return (
    <Dialog title="ヘルプ" onClose={onClose} wide>
      <div className="help-layout" data-testid="help-dialog">
        <nav className="help-nav" aria-label="ヘルプの目次">
          {HELP_SECTIONS.map((s) => (
            <button key={s.id} type="button" className={s.id === current ? 'on' : ''} aria-current={s.id === current ? 'page' : undefined} onClick={() => setCurrent(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <section className="help-body" aria-live="polite">
          <h3>{active.title}</h3>
          {active.body}
        </section>
      </div>
    </Dialog>
  );
}
