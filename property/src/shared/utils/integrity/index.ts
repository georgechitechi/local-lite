import type { IntegrityIssue, IntegrityRule, IntegrityScanData } from './types';

export class IntegrityRuleEngine {
  private rules: IntegrityRule[] = [];

  registerRule(rule: IntegrityRule) {
    this.rules.push(rule);
  }

  registerRules(rules: IntegrityRule[]) {
    this.rules.push(...rules);
  }

  evaluateAll(data: IntegrityScanData): IntegrityIssue[] {
    const results: IntegrityIssue[] = [];

    const helpers = {
      today: new Date(),
      getContractName: (c: any) => {
        const tenant = data.allTenants.find(t => t.id === c.tenant_id);
        const house = data.allHouses.find(h => h.id === c.house_id);
        return `${tenant?.name || 'Unknown Tenant'} - ${house?.house_number || 'Unknown House'}`;
      },
    };

    for (const rule of this.rules) {
      try {
        const issue = rule.evaluate(data, helpers);
        if (issue?.items && issue.items.length > 0) {
          results.push(issue);
        }
      } catch (err) {
        console.error(`Rule ${rule.id} failed:`, err);
      }
    }

    return results;
  }
}
