// Help window (ADR-054): a section list on the left, the chosen section on the right. Also shows
// the beginner's guide (ADR-056) with its chapters passed in.
import { useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { HELP_SECTIONS, type HelpSection } from './content';

export function HelpDialog({ section, sections = HELP_SECTIONS, title = 'ヘルプ', testId = 'help-dialog', onClose }: { section?: string; sections?: HelpSection[]; title?: string; testId?: string; onClose: () => void }) {
  const [current, setCurrent] = useState(section && sections.some((s) => s.id === section) ? section : sections[0].id);
  const active = sections.find((s) => s.id === current) ?? sections[0];
  return (
    <Dialog title={title} onClose={onClose} wide>
      <div className="help-layout" data-testid={testId}>
        <nav className="help-nav" aria-label="目次">
          {sections.map((s) => (
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
