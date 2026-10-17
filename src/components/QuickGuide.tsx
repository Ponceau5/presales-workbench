import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { BookOpen, X } from 'lucide-react';
import { localApi, currentPerson } from '@/lib/localApi';
type Step = {
    target: string;
    title: string;
    text: string;
};
export function QuickGuide() {
    const location = useLocation();
    const view = new URLSearchParams(location.search).get('view') || 'flow';
    const context = location.pathname === '/projects' ? 'projects' : location.pathname.startsWith('/projects/') ? (view === 'review' ? 'workspace' : view === 'flow' ? 'flow' : view === 'materials' ? 'materials' : 'other') : location.pathname === '/' ? 'home' : 'other';
    const steps: Step[] = context === 'workspace' ? [
        { target: '.gsa-quick, .gsa-composer', title: '从快捷入口开始', text: '选择一个快捷入口，核对处理要求后发送。也可以直接输入问题，并上传文件或粘贴图片。' },
        { target: '[data-tour="skill"], .gsa-composer', title: '更新 Skill', text: '点击 Skill，直接编辑输入资料、处理流程和输出要求，再试运行核对结果。正式成果由人确认采纳。' }
    ] : context === 'flow' ? [
        { target: '[data-tour="project-flow"] .project-flow-node.selected', title: '查看项目流程', text: '点击环节查看责任岗位、输入资料和成果状态。颜色提示已完成、待复核及变更影响。' },
        { target: 'a[href*="stage="]', title: '从侧栏直达工作区', text: '点击左侧项目下的流程名称，可以直接进入对应环节的工作区。' },
        { target: 'a[href*="view=materials"]', title: '查看资料与工件', text: '点击「资料与工件」，查看当前项目的原始资料、设备清单及已采纳的项目输出工件，支持查看与下载。' },
        { target: '[data-tour="open-workspace"]', title: '进入工作区', text: '选择要处理的环节，点击「打开工作区」，使用当前项目的资料开展工作。' }
    ] : context === 'projects' ? [
        { target: '[data-tour="project-list"]', title: '查找项目', text: '项目按更新时间排列。搜索名称或编号，点击项目进入；星标项目会出现在「我的关注」。' },
        { target: '[data-tour="project-list"] .file-open', title: '打开项目工作流', text: '点击项目名称，进入该项目的项目工作流；选择环节后即可打开对应工作区。' }
    ] : context === 'materials' ? [
        { target: '.resource-browser, .project-content', title: '项目资料与工件', text: '这里保存当前项目的设备清单、客户要求、报价和成果版本。选择分类查找资料，点击文件查看或下载。' }
    ] : [
        { target: '[data-tour="monitor"]', title: '查看整体项目进度', text: '按项目阶段查看整体进展，结合国家概览和跟进提示找到需关注项目。点击卡片查看档案，再进入项目流程。' },
        { target: 'a[href="/library"]', title: '公共资料', text: '公司介绍、产品手册、技术标准和通用模板放在公共资料。具体项目的清单、客户要求和报价放在对应项目。' },
        { target: 'a[href="/projects"]', title: '进入项目', text: '打开项目，选择项目流程中的环节，再进入工作区处理任务。' }
    ];
    const account = currentPerson()?.id;
    const key = 'workbench-guide-seen:' + account;
    const [open, setOpen] = useState(false), [index, setIndex] = useState(0), [rect, setRect] = useState<DOMRect | null>(null);
    const card = useRef<HTMLElement>(null);
    const restore = useRef<HTMLElement | null>(null);
    useEffect(() => {let active=true;setIndex(0);setOpen(false);if(!account)return;const previous=['home','projects','flow','workspace'].some(c=>localStorage.getItem('workbench-tour-v4:'+account+':'+c));if(localStorage.getItem(key)||previous){if(previous){localStorage.setItem(key,'1');void localApi('/api/me/guide/seen',{method:'POST'}).catch(()=>{});}return;}void localApi<{seen:boolean}>('/api/me/guide').then(result=>{if(!active)return;localStorage.setItem(key,'1');if(!result.seen){setOpen(true);void localApi('/api/me/guide/seen',{method:'POST'}).catch(()=>{});}}).catch(()=>{});return()=>{active=false;};},[account,context]);
    function close() { localStorage.setItem(key, '1'); setOpen(false); restore.current?.focus(); }
    useLayoutEffect(() => { if (!open)
        return; const update = () => { const el = document.querySelector(steps[index]?.target); setRect(el?.getBoundingClientRect() || null); }; update(); const observer = new ResizeObserver(update); observer.observe(document.body); const timer = setInterval(update, 300); window.addEventListener('resize', update); window.addEventListener('scroll', update, true); return () => { observer.disconnect(); clearInterval(timer); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); }; }, [open, index, context]);
    useEffect(() => { if (!open)
        return; restore.current = document.activeElement as HTMLElement; card.current?.focus(); }, [open]);
    const width = Math.min(320, window.innerWidth - 24), height = card.current?.offsetHeight || 200;
    const left = rect ? Math.max(12, Math.min(rect.right + 12 + width < window.innerWidth ? rect.right + 12 : rect.left, window.innerWidth - width - 12)) : Math.max(12, (window.innerWidth - width) / 2);
    const top = rect ? Math.max(12, Math.min(rect.bottom + height + 12 < window.innerHeight ? rect.bottom + 12 : rect.top - height - 12, window.innerHeight - height - 12)) : 90;
    return <><button className="quick-guide-trigger" aria-label="使用指南" title="使用指南" onClick={() => { setIndex(0); setOpen(true);localStorage.setItem(key,'1');void localApi('/api/me/guide/seen',{method:'POST'}).catch(()=>{}); }}><BookOpen size={17}/></button>{open && createPortal(<div className="tour-layer" onKeyDown={e => { if (e.key === 'Escape')
        close(); if (e.key === 'Tab') {
        const buttons = Array.from(card.current?.querySelectorAll('button') || []);
        if (e.shiftKey && document.activeElement === buttons[0]) {
            e.preventDefault();
            buttons.at(-1)?.focus();
        }
        else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
            e.preventDefault();
            buttons[0]?.focus();
        }
    } }}><svg className="tour-shade" width="100%" height="100%"><defs><mask id="tour-hole"><rect width="100%" height="100%" fill="white"/>{rect && <rect x={Math.max(4, rect.left - 4)} y={Math.max(4, rect.top - 4)} width={rect.width + 8} height={rect.height + 8} rx="8" fill="black"/>}</mask></defs><rect width="100%" height="100%" fill="#000b" mask="url(#tour-hole)"/>{rect&&<rect className="tour-focus-ring" x={Math.max(4,rect.left-4)} y={Math.max(4,rect.top-4)} width={rect.width+8} height={rect.height+8} rx="8" fill="none"/>}</svg><section ref={card} tabIndex={-1} className="tour-card" role="dialog" aria-modal="true" aria-label="使用指南" style={{ left, top, width }}><button className="tour-close" aria-label="关闭使用指南" onClick={close}><X size={16}/></button><h2>{steps[index].title}</h2><p>{steps[index].text}</p><footer><span>{index + 1} / {steps.length}</span><div>{index > 0 && <button onClick={() => setIndex(index - 1)}>上一步</button>}<button className="tour-next" onClick={() => index === steps.length - 1 ? close() : setIndex(index + 1)}>{index === steps.length - 1 ? '知道了' : '下一步'}</button></div></footer></section></div>, document.body)}</>;
}
