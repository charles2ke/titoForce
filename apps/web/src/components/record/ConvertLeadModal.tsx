import type { CrmRecord } from '@titoforce/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { invalidateRecordData } from '../../lib/hooks.ts';
import { useToast } from '../feedback.tsx';
import { LookupInput } from '../FieldInput.tsx';
import { Button, ErrorBanner, FormField, Modal, Toggle } from '../ui.tsx';

interface ConvertResult {
  account: CrmRecord;
  contact: CrmRecord;
  opportunity: CrmRecord | null;
  reusedAccount: boolean;
}

export function ConvertLeadModal({ lead, onClose }: { lead: CrmRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const company = typeof lead.fields.company === 'string' ? lead.fields.company : '';
  const [accountMode, setAccountMode] = useState<'auto' | 'existing'>('auto');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityName, setOpportunityName] = useState('');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const convert = useMutation({
    mutationFn: () =>
      api.post<ConvertResult>(`/api/leads/${lead.id}/convert`, {
        createOpportunity,
        opportunityName: createOpportunity ? opportunityName.trim() || undefined : undefined,
        accountId: accountMode === 'existing' ? (accountId ?? undefined) : undefined,
      }),
    onSuccess: async (res) => {
      setResult(res);
      await invalidateRecordData(qc);
      toast.success(t('record.convert.converted', { name: lead.name }));
    },
  });
  const blocked = accountMode === 'existing' && !accountId;

  if (result) {
    const links: { key: string; label: string; rec: CrmRecord }[] = [
      { key: 'account', label: t(result.reusedAccount ? 'record.convert.accountExisting' : 'record.convert.accountNew'), rec: result.account },
      { key: 'contact', label: t('record.convert.contactNew'), rec: result.contact },
      ...(result.opportunity ? [{ key: 'opportunity', label: t('record.convert.opportunityNew'), rec: result.opportunity }] : []),
    ];
    return (
      <Modal open onClose={onClose} size="sm" title={t('record.convert.doneTitle')} footer={<Button onClick={onClose}>{t('common.done')}</Button>}>
        <ul className="space-y-2" aria-label={t('record.convert.resultsLabel')}>
          {links.map((l) => (
            <li key={l.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{l.label}</p>
                <p className="truncate text-sm font-medium text-slate-900">{l.rec.name}</p>
              </div>
              <Link to={`/r/${l.rec.id}`} onClick={onClose} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline">
                {t('common.open')} <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={t('record.convert.title', { name: lead.name })}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={blocked} loading={convert.isPending} onClick={() => convert.mutate()}>
            {t('record.convert.action')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('record.convert.intro')}</p>
        <ErrorBanner error={convert.error} />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('record.convert.account')}</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="account-mode" className="mt-1" checked={accountMode === 'auto'} onChange={() => setAccountMode('auto')} />
            <span>{company ? t('record.convert.useNamedAccount', { name: company }) : t('record.convert.createAccount')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="radio" name="account-mode" className="mt-1" checked={accountMode === 'existing'} onChange={() => setAccountMode('existing')} />
            <span>{t('record.convert.attachExisting')}</span>
          </label>
          {accountMode === 'existing' && (
            <div className="pl-6">
              <LookupInput
                id="convert-account"
                referenceTo="account"
                value={accountId}
                label={accountName}
                placeholder={t('record.convert.searchAccounts')}
                onChange={(id, name) => {
                  setAccountId(id);
                  setAccountName(name ?? null);
                }}
              />
            </div>
          )}
        </fieldset>
        <div className="space-y-2">
          <Toggle checked={createOpportunity} onChange={setCreateOpportunity} label={t('record.convert.createOpportunity')} />
          {createOpportunity && (
            <FormField label={t('record.convert.opportunityName')} htmlFor="convert-opp-name" help={t('record.convert.opportunityNameHelp')}>
              <input id="convert-opp-name" className="input" maxLength={255} value={opportunityName} onChange={(e) => setOpportunityName(e.target.value)} />
            </FormField>
          )}
        </div>
      </div>
    </Modal>
  );
}
