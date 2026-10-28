'use client';

import React from 'react';
import { X, Info, Shield } from 'lucide-react';

interface AnalyticsDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDisable: () => void;
}

export default function AnalyticsDataModal({ isOpen, onClose, onConfirmDisable }: AnalyticsDataModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">使用统计收集哪些信息</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭使用统计说明"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Privacy Notice */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-green-800">
                <p className="font-semibold mb-1">隐私说明</p>
                <p>使用统计默认关闭。开启后仅收集 <strong>匿名使用信息</strong>，不收集会议内容、姓名、文件路径或个人资料。</p>
              </div>
            </div>
          </div>

          {/* Data Categories */}
          <details className="space-y-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">开启后收集的信息</summary>

            {/* Model Preferences */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">1. 模型偏好</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 转写模型，例如 Whisper large-v3、Parakeet</li>
                <li>• 纪要模型，例如 Llama 3.2、Claude Sonnet</li>
                <li>• 模型来源，例如本地、Ollama、OpenRouter</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">用于了解模型使用情况</p>
            </div>

            {/* Meeting Metrics */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">2. 匿名会议统计</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 录音时长，例如 125 秒</li>
                <li>• 暂停时长，例如 5 秒</li>
                <li>• 转写段数</li>
                <li>• 已处理音频分块数</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">用于优化性能和了解使用情况</p>
            </div>

            {/* Device Types */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">3. 设备类型</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 麦克风类型：蓝牙、有线或未知</li>
                <li>• 系统音频设备类型：蓝牙、有线或未知</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">用于改善兼容性，不包含设备名称</p>
            </div>

            {/* Usage Patterns */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">4. 应用使用情况</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 应用启动与退出</li>
                <li>• 使用时长</li>
                <li>• 功能使用，例如修改设置</li>
                <li>• 错误发生情况，用于修复问题</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">用于改善使用体验</p>
            </div>

            {/* Platform Info */}
            <div className="border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">5. 系统信息</h4>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>• 操作系统，例如 macOS、Windows</li>
                <li>• 应用版本</li>
                <li>• 处理器架构，例如 x86_64、aarch64</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">用于安排系统适配</p>
            </div>
          </details>

          {/* What We DON'T Collect */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h4 className="font-semibold text-red-900 mb-2">不收集的内容</h4>
            <ul className="text-sm text-red-800 space-y-1 ml-4">
              <li>• 会议名称</li>
              <li>• 文件名、路径或会议文件夹</li>
              <li>• 会议转写或正文</li>
              <li>• 录音文件</li>
              <li>• 设备名称，仅记录蓝牙或有线类型</li>
              <li>• 个人资料</li>
              <li>• 可识别个人身份的数据</li>
            </ul>
          </div>

          {/* Example Event */}
          <details className="rounded-lg border border-border bg-muted/50 p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">统计数据示例（技术信息）</summary>
            <pre className="mt-3 overflow-x-auto text-xs text-muted-foreground">
              {`{
  "event": "meeting_ended",
  "app_version": "0.4.1",
  "transcription_provider": "parakeet",
  "transcription_model": "parakeet-tdt-0.6b-v3-int8",
  "summary_provider": "ollama",
  "summary_model": "llama3.2:latest",
  "total_duration_seconds": "125.5",
  "microphone_device_type": "Wired",
  "system_audio_device_type": "Bluetooth",
  "chunks_processed": "150",
  "had_fatal_error": "false"
}`}
            </pre>
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            保持开启
          </button>
          <button
            onClick={onConfirmDisable}
            className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
          >
            关闭使用统计
          </button>
        </div>
      </div>
    </div>
  );
}
