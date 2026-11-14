import { useState, useEffect, useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';

const TEMPLATE_LABELS: Record<string, { name: string; description: string }> = {
  standard_meeting: { name: '通用会议', description: '整理主要结论与后续行动。' },
  daily_standup: { name: '每日站会', description: '整理团队成员的每日进展。' },
  project_sync: { name: '项目进展', description: '跟进项目里程碑、进度与风险。' },
  retrospective: { name: '团队复盘', description: '回顾迭代过程与改进事项。' },
  sales_marketing_client_call: { name: '客户与销售会议', description: '整理客户目标、交付内容与下一步。' },
  psychatric_session: { name: '精神科诊疗记录', description: '按 SOAP 结构整理诊疗内容。' },
};

export function useTemplates() {
  const [availableTemplates, setAvailableTemplates] = useState<Array<{
    id: string;
    name: string;
    description: string;
  }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard_meeting');

  // Fetch available templates on mount
  useEffect(() => {
    let cancelled = false;
    const fetchTemplates = async () => {
      try {
        const templates = await invokeTauri('api_list_templates') as Array<{
          id: string;
          name: string;
          description: string;
        }>;
        if (cancelled) return;
        setAvailableTemplates(templates.map(template => ({ ...template, ...TEMPLATE_LABELS[template.id] })));
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };
    fetchTemplates();
    return () => { cancelled = true; };
  }, []);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('已选择纪要模板', {
      description: `使用「${templateName}」整理纪要`,
    });
    void Analytics.trackFeatureUsed('template_selected').catch(error => console.error('Failed to track template selection:', error));
  }, []);

  return {
    availableTemplates,
    selectedTemplate,
    handleTemplateSelection,
  };
}
