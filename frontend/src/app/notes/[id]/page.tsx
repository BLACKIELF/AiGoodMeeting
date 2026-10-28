import React from 'react';
import { Clock, Users, Calendar, Tag } from 'lucide-react';

interface PageProps {
  params: {
    id: string;
  };
}

interface Note {
  title: string;
  date: string;
  time?: string;
  attendees?: string[];
  tags: string[];
  content: string;
}

export function generateStaticParams() {
  // Return all possible note IDs
  return [
    { id: 'team-sync-dec-26' },
    { id: 'product-review' },
    { id: 'project-ideas' },
    { id: 'action-items' }
  ];
}

const NotePage = ({ params }: PageProps) => {
  // This would normally come from your database
  const sampleData: Record<string, Note> = {
    'team-sync-dec-26': {
      title: '团队同步会 · 12 月 26 日',
      date: '2024-12-26',
      time: '10:00–11:00',
      attendees: ['John Doe', 'Jane Smith', 'Mike Johnson'],
      tags: ['团队同步', '每周', '产品'],
      content: `
# 会议纪要
团队讨论 2024 年第一季度目标和当前项目进展。

## 会议议程
1. 项目进展更新
2. 2024 年第一季度规划
3. 团队问题与反馈

## 主要决策
- 第一季度优先开发移动应用
- 安排每周设计评审
- 在路线图中增加两项新功能

## 待办事项
- [ ] John：制定项目时间表
- [ ] Jane：安排设计评审会议
- [ ] Mike：更新文档

## 备注
- 讨论当前项目瓶颈
- 回顾上一版本的客户反馈
- 规划下一次迭代的资源安排
      `
    },
    'product-review': {
      title: '产品评审',
      date: '2024-12-26',
      time: '14:00–15:00',
      attendees: ['Sarah Wilson', 'Tom Brown', 'Alex Chen'],
      tags: ['产品', '评审', '季度'],
      content: `
# 产品评审会议

## 概览
与相关成员进行季度产品评审。

## 讨论要点
1. 第四季度表现回顾
2. 功能优先级
3. 客户反馈分析

## 待办事项
- [ ] 更新产品路线图
- [ ] 安排用户研究
- [ ] 评审竞品分析
      `
    },
    'project-ideas': {
      title: '项目想法',
      date: '2024-12-26',
      tags: ['想法', '规划'],
      content: `
# 项目想法

## 新功能
1. AI 会议纪要
2. 日历集成
3. 团队协作工具

## 改进事项
- 改进搜索功能
- 改进笔记组织方式
- 实时协作
      `
    },
    'action-items': {
      title: '待办事项',
      date: '2024-12-26',
      tags: ['任务', '待办', '规划'],
      content: `
# 待办事项

## 高优先级
- [ ] 部署 2.0 版本
- [ ] 修复重要安全问题
- [ ] 完成使用文档

## 中优先级
- [ ] 更新依赖
- [ ] 实现错误追踪
- [ ] 添加单元测试

## 低优先级
- [ ] 重构旧代码
- [ ] 改进代码说明
- [ ] 制定开发规范
      `
    }
  };

  const note = sampleData[params.id as keyof typeof sampleData];

  if (!note) {
    return <div className="p-8">未找到这篇笔记</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <p className="mb-2 text-xs text-muted-foreground">示例笔记</p>
        <h1 className="text-3xl font-bold mb-4">{note.title}</h1>
        
        <div className="flex flex-wrap gap-4 text-muted-foreground">
          {note.date && (
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{note.date}</span>
            </div>
          )}
          
          {note.time && (
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{note.time}</span>
            </div>
          )}
          
          {note.attendees && (
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{note.attendees.join(', ')}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          {note.tags.map((tag) => (
            <div key={tag} className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded-full text-sm">
              <Tag className="w-3 h-3" />
              {tag}
            </div>
          ))}
        </div>
      </div>

      <div className="prose dark:prose-invert max-w-none">
        <div dangerouslySetInnerHTML={{ __html: note.content.split('\n').map(line => {
          if (line.startsWith('# ')) {
            return `<h1>${line.slice(2)}</h1>`;
          } else if (line.startsWith('## ')) {
            return `<h2>${line.slice(3)}</h2>`;
          } else if (line.startsWith('- ')) {
            return `<li>${line.slice(2)}</li>`;
          }
          return line;
        }).join('\n') }} />
      </div>
    </div>
  );
};

export default NotePage;
