ALTER TABLE site_audits ADD COLUMN audit_job_queue_id UUID REFERENCES audit_job_queue(id);
