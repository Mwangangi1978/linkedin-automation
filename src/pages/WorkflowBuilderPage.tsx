import {
  CheckCircle2,
  Clock3,
  Database,
  Linkedin,
  MessageSquare,
  MoreVertical,
  Plus,
  Play,
  Save,
  Send,
  SlidersHorizontal,
  Users2,
} from 'lucide-react';
import type { ReactNode } from 'react';

function NodeCard(props: {
  type: string;
  title: string;
  detail: string;
  icon: ReactNode;
  detailIcon: ReactNode;
  trigger?: boolean;
}) {
  return (
    <div className="node-card">
      <div className="node-header">
        <div className={`node-icon-wrapper ${props.trigger ? 'trigger' : 'action'}`}>{props.icon}</div>
        <div className="node-info">
          <span className="node-subtitle">{props.type}</span>
          <h3 className="node-title">{props.title}</h3>
        </div>
        <CheckCircle2 className="status-icon" size={22} />
        <div className="node-menu"><MoreVertical size={18} /></div>
      </div>
      <div className="node-details">
        {props.detailIcon}
        <span>{props.detail}</span>
      </div>
    </div>
  );
}

function Connector({ active = true }: { active?: boolean }) {
  return (
    <div className="connection-wrapper">
      <div className={`connection-line ${active ? 'active' : 'inactive'}`} />
      {active ? (
        <button className="add-between-btn">
          <Plus size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function WorkflowBuilderPage() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <h1 className="page-title">Lead Gen Flow</h1>
          <span className="status-badge"><span className="dot" /> Active</span>
        </div>
        <div className="topbar-right">
          <button className="btn btn-secondary"><Play size={16} /> Run Test</button>
          <button className="btn btn-primary"><Save size={16} /> Publish</button>
        </div>
      </header>

      <div className="canvas-area">
        <NodeCard
          type="Trigger"
          title="LinkedIn Post Scraper"
          detail="Scheduled • Every 4 hours"
          icon={<Linkedin size={20} />}
          detailIcon={<Clock3 size={14} />}
          trigger
        />
        <Connector />
        <NodeCard
          type="Action 1"
          title="Supabase Deduplication"
          detail="Filter by unique post_id"
          icon={<Database size={20} />}
          detailIcon={<SlidersHorizontal size={14} />}
        />
        <Connector />
        <NodeCard
          type="Action 2"
          title="Comment Scraper"
          detail="Extract authors from comments"
          icon={<MessageSquare size={20} />}
          detailIcon={<Users2 size={14} />}
        />
        <Connector />
        <NodeCard
          type="Action 3"
          title="CRM Delivery"
          detail="Push new leads to HubSpot"
          icon={<Send size={20} />}
          detailIcon={<Send size={14} />}
        />
        <Connector active={false} />
        <button className="add-node-wrapper"><Plus size={18} /></button>
      </div>
    </>
  );
}
