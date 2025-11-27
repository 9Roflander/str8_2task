import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QuestionPopupProps {
  question: string;
  onClose: () => void;
  duration?: number; // in seconds
}

export function QuestionPopup({ question, onClose, duration = 30 }: QuestionPopupProps) {
  useEffect(() => {
    console.log('🎬 [QuestionPopup] Component mounted with question:', question);
    console.log('⏱️ [QuestionPopup] Will auto-dismiss in', duration, 'seconds');
    
    const timer = setTimeout(() => {
      console.log('⏰ [QuestionPopup] Auto-dismissing after', duration, 'seconds');
      onClose();
    }, duration * 1000);

    return () => {
      console.log('🧹 [QuestionPopup] Component unmounting, clearing timer');
      clearTimeout(timer);
    };
  }, [onClose, duration]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-4 right-4 z-50 max-w-md"
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">
                🤔 Clarification Needed
              </div>
              <p className="text-sm text-gray-900 dark:text-gray-100">
                {question}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

