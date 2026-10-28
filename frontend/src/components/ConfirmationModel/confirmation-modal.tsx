import React from 'react';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
}

export function ConfirmationModal({ onConfirm, onCancel, text, isOpen }: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card border border-border text-foreground rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-4">确认删除</h2>
        <p className="text-muted-foreground mb-6">{text}</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-muted-foreground hover:bg-accent rounded-md transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-md transition-colors"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
