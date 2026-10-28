import { toUserMessage } from '@/lib/user-message';
import {useEffect, useState} from 'react';

interface MessageToastProps {
    message: string;
    type: 'success' | 'error';
    show: boolean;
    setShow: (show: boolean) => void;
}

export function MessageToast({ message, type, show, setShow }: MessageToastProps) {
    
    useEffect(() => {
        const timer = setTimeout(() => {
            setShow(false);
        }, 3000);
        
        return () => clearTimeout(timer);
    }, []); 
    
    return (
        show && (
            <span className={`${type === 'success' ? 'text-green-500' : 'text-red-500'}`}>{toUserMessage(message, type === 'success' ? '操作已完成。' : '操作未完成，请重试。')}</span>
        )
    );
}