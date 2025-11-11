const logger = require('./logger');

class SupabaseClientBrowser {
  constructor(supabaseUrl, anonKey, serviceKey = null) {
    this.supabaseUrl = supabaseUrl;
    this.anonKey = anonKey;
    this.serviceKey = serviceKey;

    if (!supabaseUrl || !anonKey) {
      logger.warn('Supabase configuration incomplete', {
        hasUrl: !!supabaseUrl,
        hasKey: !!anonKey
      });
    }
  }

  async insertAuditResult(auditData) {
    try {
      if (!this.supabaseUrl || !this.anonKey) {
        logger.warn('Supabase not configured, skipping audit result insert');
        return null;
      }

      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/audit_results`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anonKey}`,
            'apikey': this.anonKey,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(auditData)
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        logger.error('Failed to insert audit result', {
          status: response.status,
          error
        });
        return null;
      }

      const data = await response.json();
      logger.info('Audit result inserted', {
        id: data[0]?.id,
        domain: auditData.domain
      });

      return data[0];
    } catch (error) {
      logger.error('Error inserting audit result', error);
      return null;
    }
  }

  async updateAuditResult(auditId, updates) {
    try {
      if (!this.supabaseUrl || !this.anonKey) {
        logger.warn('Supabase not configured, skipping audit result update');
        return null;
      }

      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/audit_results?id=eq.${auditId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anonKey}`,
            'apikey': this.anonKey,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updates)
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        logger.error('Failed to update audit result', {
          status: response.status,
          error
        });
        return null;
      }

      logger.info('Audit result updated', { id: auditId });
      return true;
    } catch (error) {
      logger.error('Error updating audit result', error);
      return null;
    }
  }

  async insertAnalysisError(errorData) {
    try {
      if (!this.supabaseUrl || !this.anonKey) {
        logger.warn('Supabase not configured, skipping error insert');
        return null;
      }

      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/ai_analysis_errors`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anonKey}`,
            'apikey': this.anonKey,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(errorData)
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        logger.error('Failed to insert analysis error', {
          status: response.status,
          error
        });
        return null;
      }

      logger.info('Analysis error recorded');
      return true;
    } catch (error) {
      logger.error('Error inserting analysis error', error);
      return null;
    }
  }

  async insertAdminAlert(alertData) {
    try {
      if (!this.supabaseUrl || !this.anonKey) {
        logger.warn('Supabase not configured, skipping alert insert');
        return null;
      }

      const response = await fetch(
        `${this.supabaseUrl}/rest/v1/admin_alerts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anonKey}`,
            'apikey': this.anonKey,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(alertData)
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        logger.error('Failed to insert admin alert', {
          status: response.status,
          error
        });
        return null;
      }

      logger.info('Admin alert created');
      return true;
    } catch (error) {
      logger.error('Error inserting admin alert', error);
      return null;
    }
  }
}

module.exports = SupabaseClientBrowser;
