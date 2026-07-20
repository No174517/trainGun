/* ============================================================
   TrainGun - 游戏引擎核心
   包含：Game Loop, Pointer Lock, 准星, 目标基类, 粒子系统, HUD
   新增：3D 球体渲染, 小人目标, 可配置准星, 目标自定义
   ============================================================ */

import { updateHUD, showCountdown, showTrainingOverlay, hideTrainingOverlay, showResult } from './ui.js';
import { saveTrainingResult, getBestScores, loadCustomization, getDefaultCustomization, saveSensitivity, loadSensitivity } from './storage.js';
import { Weapon, WEAPON_PRESETS } from './weapon.js';
import { audioManager } from './audio.js';
import { keybindManager, ACTIONS } from './keybinds.js';
import { calculateFromGame, getDefaultConfig } from './sensitivity.js';

/* ==================== 粒子系统 ==================== */
class Particle {
    constructor(x, y, color, speed, angle, life) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.speed = speed;
        this.angle = angle;
        this.life = life;
        this.maxLife = life;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.size = Math.random() * 3 + 1;
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vx *= 0.98;
        this.vy *= 0.98;
        this.life -= dt;
    }

    render(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    get isDead() {
        return this.life <= 0;
    }
}

class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    emit(x, y, color = '#00fff0', count = 15) {
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
            const speed = 100 + Math.random() * 200;
            const life = 0.3 + Math.random() * 0.5;
            this.particles.push(new Particle(x, y, color, speed, angle, life));
        }
    }

    update(dt) {
        this.particles = this.particles.filter(p => {
            p.update(dt);
            return !p.isDead;
        });
    }

    render(ctx) {
        this.particles.forEach(p => p.render(ctx));
    }
}

/* ==================== 浮动文字 ==================== */
class FloatingText {
    constructor(x, y, text, color, fontSize = 18, duration = 0.8) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.fontSize = fontSize;
        this.life = duration;
        this.maxLife = duration;
        this.vy = -80;
    }

    update(dt) {
        this.y += this.vy * dt;
        this.vy *= 0.95;
        this.life -= dt;
    }

    render(ctx) {
        const alpha = Math.max(0, this.life / this.maxLife);
        const scale = 0.8 + (1 - alpha) * 0.4;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${Math.round(this.fontSize * scale)}px Orbitron`;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }

    get isDead() {
        return this.life <= 0;
    }
}

/* ==================== 辅助函数：解析颜色 ==================== */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 51, b: 102 };
}

/* ==================== 目标基类（3D 球体） ==================== */
export class Target {
    constructor(x, y, radius, color = null, opacity = null) {
        // 从配置中读取颜色和透明度
        const custom = loadCustomization() || getDefaultCustomization();
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color || custom.targetColor || '#ff3366';
        this.opacity = opacity !== null ? opacity : (custom.targetOpacity !== undefined ? custom.targetOpacity : 0.9);
        this.state = 'active'; // active, hit, expired
        this.spawnTime = performance.now();
        this.scale = 0;
        this.glowIntensity = 0;
    }

    isHit(px, py) {
        if (this.state !== 'active') return false;
        const dx = px - this.x;
        const dy = py - this.y;
        return (dx * dx + dy * dy) <= (this.radius * this.radius);
    }

    update(dt) {
        if (this.scale < 1) {
            this.scale = Math.min(1, this.scale + dt * 8);
        }
        this.glowIntensity = 0.5 + Math.sin(performance.now() / 300) * 0.3;
    }

    /**
     * 渲染 3D 球体效果
     */
    render(ctx) {
        if (this.state !== 'active') return;

        const r = this.radius * this.scale;
        const rgb = hexToRgb(this.color);

        ctx.save();
        ctx.globalAlpha = this.opacity;

        // 外发光
        const glowSize = 10 + this.glowIntensity * 12;
        ctx.shadowBlur = glowSize;
        ctx.shadowColor = this.color;

        // 底色球体
        const baseGrad = ctx.createRadialGradient(
            this.x - r * 0.3, this.y - r * 0.3, r * 0.05,
            this.x, this.y, r
        );
        baseGrad.addColorStop(0, `rgba(${Math.min(255, rgb.r + 80)}, ${Math.min(255, rgb.g + 80)}, ${Math.min(255, rgb.b + 80)}, 1)`);
        baseGrad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);
        baseGrad.addColorStop(1, `rgba(${Math.max(0, rgb.r - 60)}, ${Math.max(0, rgb.g - 60)}, ${Math.max(0, rgb.b - 60)}, 0.8)`);

        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fillStyle = baseGrad;
        ctx.fill();

        // 3D 高光（左上角白色光斑）
        ctx.shadowBlur = 0;
        const highlightGrad = ctx.createRadialGradient(
            this.x - r * 0.3, this.y - r * 0.35, r * 0.02,
            this.x - r * 0.15, this.y - r * 0.2, r * 0.5
        );
        highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        highlightGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
        highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fillStyle = highlightGrad;
        ctx.fill();

        // 边缘光环
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    }
}

/* ==================== 小人目标 ==================== */
export class HumanoidTarget {
    /**
     * @param {number} x - 中心 X
     * @param {number} y - 脚底 Y（小人站立位置）
     * @param {number} scale - 缩放（1=正常大小）
     */
    constructor(x, y, scale = 1) {
        this.x = x;
        this.y = y;
        this.scale = scale;
        this.state = 'active'; // active, hit, expired
        this.spawnTime = performance.now();
        this.spawnScale = 0; // 出现动画

        // 小人比例定义（相对值，乘以 scale）
        this.headRadius = 14 * scale;
        this.bodyWidth = 22 * scale;
        this.bodyHeight = 40 * scale;
        this.legHeight = 30 * scale;
        this.armLength = 18 * scale;

        // 计算关键点
        this.totalHeight = this.headRadius * 2 + this.bodyHeight + this.legHeight;
        this.headCenterY = y - this.totalHeight + this.headRadius;

        // 血量系统
        this.maxHp = 3;
        this.hp = 3;

        // 颜色
        this.bodyColor = '#4488ff';
        this.headColor = '#ffcc88';
        this.hitFlash = 0;

        // 死亡动画
        this.deathY = 0;
        this.deathRotation = 0;
    }

    get isDead() {
        return this.hp <= 0;
    }

    /**
     * 检测命中部位
     * @returns {'head'|'body'|null}
     */
    getHitZone(px, py) {
        if (this.state !== 'active') return null;

        const s = this.spawnScale;

        // 头部判定（圆形）
        const headCX = this.x;
        const headCY = this.headCenterY;
        const headR = this.headRadius;
        const hdx = px - headCX;
        const hdy = py - headCY;
        if ((hdx * hdx + hdy * hdy) <= (headR * headR)) {
            return 'head';
        }

        // 身体判定（矩形区域，包含躯干和腿）
        const bodyTop = headCY + headR;
        const bodyBottom = this.y;
        const bodyLeft = this.x - this.bodyWidth / 2;
        const bodyRight = this.x + this.bodyWidth / 2;
        if (px >= bodyLeft && px <= bodyRight && py >= bodyTop && py <= bodyBottom) {
            return 'body';
        }

        return null;
    }

    /**
     * 兼容 isHit 接口（任何部位命中）
     */
    isHit(px, py) {
        return this.getHitZone(px, py) !== null;
    }

    /**
     * 受到伤害
     * @param {string} zone - 'head' 或 'body'
     * @returns {Object} { killed: boolean, headshot: boolean, damage: number }
     */
    takeDamage(zone) {
        if (zone === 'head') {
            // 爆头一击毙命
            this.hp = 0;
            this.state = 'hit';
            return { killed: true, headshot: true, damage: this.maxHp };
        } else {
            // 身体 -1 HP
            this.hp -= 1;
            this.hitFlash = 0.15; // 闪烁
            if (this.hp <= 0) {
                this.state = 'hit';
                return { killed: true, headshot: false, damage: 1 };
            }
            return { killed: false, headshot: false, damage: 1 };
        }
    }

    update(dt) {
        if (this.spawnScale < 1) {
            this.spawnScale = Math.min(1, this.spawnScale + dt * 6);
        }
        if (this.hitFlash > 0) {
            this.hitFlash -= dt;
        }
    }

    render(ctx) {
        if (this.state !== 'active') return;

        const s = this.spawnScale;
        if (s < 0.01) return;

        ctx.save();

        // 出现动画：从脚底向上生长
        ctx.translate(this.x, this.y);
        ctx.scale(s, s);
        ctx.translate(-this.x, -this.y);

        const flashColor = this.hitFlash > 0 ? 'rgba(255,60,60,0.6)' : null;

        // ---- 阴影 ----
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 2, this.bodyWidth * 0.6, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // ---- 腿部 ----
        const legTop = this.y - this.legHeight;
        const legSpread = this.bodyWidth * 0.3;
        ctx.strokeStyle = flashColor || '#3366cc';
        ctx.lineWidth = 5 * this.scale;
        ctx.lineCap = 'round';

        // 左腿
        ctx.beginPath();
        ctx.moveTo(this.x - legSpread * 0.5, legTop);
        ctx.lineTo(this.x - legSpread, this.y);
        ctx.stroke();

        // 右腿
        ctx.beginPath();
        ctx.moveTo(this.x + legSpread * 0.5, legTop);
        ctx.lineTo(this.x + legSpread, this.y);
        ctx.stroke();

        // ---- 躯干 ----
        const bodyTop = legTop - this.bodyHeight;
        const bodyGrad = ctx.createLinearGradient(this.x, bodyTop, this.x, legTop);
        bodyGrad.addColorStop(0, flashColor || '#5599ff');
        bodyGrad.addColorStop(1, flashColor || '#3366cc');

        ctx.fillStyle = bodyGrad;
        const bw = this.bodyWidth;
        const cornerR = 4 * this.scale;
        this._roundRect(ctx, this.x - bw / 2, bodyTop, bw, this.bodyHeight, cornerR);
        ctx.fill();

        // 身体轮廓
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, this.x - bw / 2, bodyTop, bw, this.bodyHeight, cornerR);
        ctx.stroke();

        // ---- 手臂 ----
        ctx.strokeStyle = flashColor || '#4488ee';
        ctx.lineWidth = 4 * this.scale;
        ctx.lineCap = 'round';

        const shoulderY = bodyTop + 6 * this.scale;

        // 左臂
        ctx.beginPath();
        ctx.moveTo(this.x - bw / 2, shoulderY);
        ctx.lineTo(this.x - bw / 2 - this.armLength, shoulderY + this.armLength * 0.8);
        ctx.stroke();

        // 右臂
        ctx.beginPath();
        ctx.moveTo(this.x + bw / 2, shoulderY);
        ctx.lineTo(this.x + bw / 2 + this.armLength, shoulderY + this.armLength * 0.8);
        ctx.stroke();

        // ---- 头部 ----
        const headCY = bodyTop - this.headRadius;
        this.headCenterY = headCY; // 更新头部中心

        // 头部发光
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#ffcc88';

        // 头部圆形
        const headGrad = ctx.createRadialGradient(
            this.x - this.headRadius * 0.2, headCY - this.headRadius * 0.2, this.headRadius * 0.05,
            this.x, headCY, this.headRadius
        );
        headGrad.addColorStop(0, flashColor || '#ffe0a0');
        headGrad.addColorStop(0.6, flashColor || '#ffcc88');
        headGrad.addColorStop(1, flashColor || '#cc9944');
        ctx.fillStyle = headGrad;

        ctx.beginPath();
        ctx.arc(this.x, headCY, this.headRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 头部轮廓
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(this.x, headCY, this.headRadius, 0, Math.PI * 2);
        ctx.stroke();

        // ---- HP 条 ----
        if (this.hp < this.maxHp) {
            const barW = bw;
            const barH = 3 * this.scale;
            const barX = this.x - barW / 2;
            const barY = headCY - this.headRadius - 8 * this.scale;
            const hpRatio = this.hp / this.maxHp;

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, barY, barW, barH);

            const hpColor = hpRatio > 0.5 ? '#00ff88' : (hpRatio > 0.25 ? '#ffaa00' : '#ff3366');
            ctx.fillStyle = hpColor;
            ctx.fillRect(barX, barY, barW * hpRatio, barH);
        }

        ctx.restore();
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }
}

/* ==================== 准星（可自定义） ==================== */
class Crosshair {
    constructor() {
        this.x = 0;
        this.y = 0;

        // 加载自定义配置
        this.loadConfig();
    }

    loadConfig() {
        const custom = loadCustomization() || getDefaultCustomization();
        const ch = custom.crosshair || {};
        this.color = ch.color || '#00fff0';
        this.size = ch.size || 12;
        this.gap = ch.gap || 4;
        this.thickness = ch.thickness || 2;
        this.dotSize = ch.dotSize || 2;
        this.style = ch.style || 'cross'; // cross, dot, circle, crossdot
        this.opacity = ch.opacity !== undefined ? ch.opacity : 1;
    }

    move(dx, dy, canvasWidth, canvasHeight) {
        this.x = Math.max(0, Math.min(canvasWidth, this.x + dx));
        this.y = Math.max(0, Math.min(canvasHeight, this.y + dy));
    }

    render(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.strokeStyle = this.color;
        ctx.fillStyle = this.color;
        ctx.lineWidth = this.thickness;
        ctx.shadowBlur = 6;
        ctx.shadowColor = this.color;

        switch (this.style) {
            case 'dot':
                this._renderDot(ctx);
                break;
            case 'circle':
                this._renderCircle(ctx);
                break;
            case 'crossdot':
                this._renderCrossLines(ctx);
                this._renderDot(ctx);
                break;
            case 'cross':
            default:
                this._renderCrossLines(ctx);
                // 中心点
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.dotSize, 0, Math.PI * 2);
                ctx.fill();
                break;
        }

        ctx.restore();
    }

    _renderCrossLines(ctx) {
        // 上
        ctx.beginPath();
        ctx.moveTo(this.x, this.y - this.gap);
        ctx.lineTo(this.x, this.y - this.gap - this.size);
        ctx.stroke();
        // 下
        ctx.beginPath();
        ctx.moveTo(this.x, this.y + this.gap);
        ctx.lineTo(this.x, this.y + this.gap + this.size);
        ctx.stroke();
        // 左
        ctx.beginPath();
        ctx.moveTo(this.x - this.gap, this.y);
        ctx.lineTo(this.x - this.gap - this.size, this.y);
        ctx.stroke();
        // 右
        ctx.beginPath();
        ctx.moveTo(this.x + this.gap, this.y);
        ctx.lineTo(this.x + this.gap + this.size, this.y);
        ctx.stroke();
    }

    _renderDot(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.dotSize + 1, 0, Math.PI * 2);
        ctx.fill();
    }

    _renderCircle(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.stroke();
        // 中心点
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.dotSize, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ==================== 游戏引擎 ==================== */
export class GameEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.crosshair = new Crosshair();
        this.particles = new ParticleSystem();
        this.floatingTexts = [];
        this.targets = [];

        // 统计
        this.state = 'idle';
        this.score = 0;
        this.hits = 0;
        this.misses = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.weapon = WEAPON_PRESETS.vandal; // 默认使用 Vandal
        this.totalClicks = 0;
        this.headshots = 0;
        this.reactionTimes = [];
        this.duration = 60;
        this.elapsed = 0;
        this.trackingFrames = 0;
        this.trackingHitFrames = 0;

        // 灵敏度
        const config = loadSensitivity() || getDefaultConfig();
        this.webSensitivity = config.webSensitivity || 1;

        // 模式
        this.mode = null;
        this.difficulty = 'medium';
        this.modeHandler = null;

        // 视觉状态
        this.gunOffset = { x: 0, y: 0 };
        this.shake = 0;

        // 帧计时
        this.lastTime = 0;
        this.animFrameId = null;
        this.isLocked = false;

        // 绑定
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onPointerLockChange = this._onPointerLockChange.bind(this);
        this._gameLoop = this._gameLoop.bind(this);

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.state === 'idle') {
            this.crosshair.x = this.canvas.width / 2;
            this.crosshair.y = this.canvas.height / 2;
        }
    }

    async init(mode, difficulty, modeHandler, options = {}) {
        this.mode = mode;
        this.difficulty = difficulty;
        this.modeHandler = modeHandler;
        this.onComplete = options.onComplete;

        // ...

        // ... (lines 638-655 skipped in output, but I need to be careful with context)
        // I will just replace the start of function and duration logic.

        // 重置
        this.score = 0;
        this.hits = 0;
        this.misses = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.totalClicks = 0;
        this.headshots = 0;
        this.reactionTimes = [];
        this.elapsed = 0;
        this.shake = 0; // 屏幕震动强度
        this.shotHistory = [];
        this.traceHistory = [];
        this.traceHistory = [];
        this.trackingFrames = 0;
        this.trackingHitFrames = 0;
        this.targets = [];
        this.particles.particles = [];
        this.floatingTexts = [];

        this.duration = options.duration || (modeHandler.getDuration ? modeHandler.getDuration(difficulty) : 60);

        // 重新加载灵敏度和准星配置
        const config = loadSensitivity() || getDefaultConfig();
        this.webSensitivity = config.webSensitivity || 1;
        this.crosshair.loadConfig();

        this.crosshair.x = this.canvas.width / 2;
        this.crosshair.y = this.canvas.height / 2;

        this.crosshair.y = this.canvas.height / 2;

        // 重置武器状态
        this.weapon.currentAmmo = this.weapon.magazineSize;
        this.weapon.isReloading = false;
        this.weapon.currentRecoil = { x: 0, y: 0 };

        modeHandler.init(this, difficulty);

        updateHUD({ score: 0, timer: this.duration, accuracy: 100, combo: 0, ammo: `${this.weapon.currentAmmo}/${this.weapon.magazineSize}`, weapon: this.weapon.name });

        this.state = 'countdown';
        await this._requestPointerLock();
        await showCountdown();

        this.state = 'running';
        hideTrainingOverlay();
        this.lastTime = performance.now();
        this._startLoop();
    }

    async _requestPointerLock() {
        try { await this.canvas.requestPointerLock(); } catch (e) {
            console.warn('[Engine] Pointer Lock failed:', e);
        }
        document.addEventListener('pointerlockchange', this._onPointerLockChange);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('pointerlockchange', this._onPointerLockChange);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mousedown', this._onMouseDown);
        document.addEventListener('keydown', this._onKeyDown);
    }

    _onPointerLockChange() {
        this.isLocked = document.pointerLockElement === this.canvas;
        if (!this.isLocked && this.state === 'running') this.pause();
    }

    _onMouseMove(e) {
        if (!this.isLocked || this.state !== 'running') return;
        const dx = e.movementX * this.webSensitivity;
        const dy = e.movementY * this.webSensitivity;
        this.crosshair.move(dx, dy, this.canvas.width, this.canvas.height);
       this.traceHistory.push({
    x:this.crosshair.x / this.canvas.width,
    y:this.crosshair.y / this.canvas.height,
    t:performance.now()

});
    }

    _onMouseDown(e) {
        if (this.state !== 'running') return;

        // ADS (Alt Fire / Scope)
        if (keybindManager.isAction(ACTIONS.ADS, e)) {
            this.weapon.toggleScope();
            return;
        }

        // Fire
        if (!keybindManager.isAction(ACTIONS.FIRE, e)) return;
        if (this.mode === 'tracking') return;

        // 尝试开火
        const fireResult = this.weapon.fire(performance.now());
        if (!fireResult.fired) {
            return;
        }

        // 播放射击音效
        audioManager.playShoot(this.weapon.type || 'rifle');
        this.shake += this.weapon.damage > 80 ? 5 : 2; // 根据伤害震动

        // 视觉后坐力 (枪身动画)
        this.gunOffset.y += 15;
        this.gunOffset.x -= 5;

        this.totalClicks++;
        let hitAny = false;

        // 计算带后坐力的实际命中点
        const recoilOffset = this.weapon.getOffset();
        const aimX = this.crosshair.x + recoilOffset.x;
        const aimY = this.crosshair.y + recoilOffset.y;



        for (const target of this.targets) {
            if (target.state !== 'active') continue;

            if (target instanceof HumanoidTarget) {
                const zone = target.getHitZone(aimX, aimY);
                if (zone) {
                    hitAny = true;
                    const result = target.takeDamage(zone);
                    const reactionTime = performance.now() - target.spawnTime;
                    this.reactionTimes.push(reactionTime);

                    if (result.headshot) {
                        this.headshots++;
                        this.particles.emit(aimX, aimY, '#ff3333', 30);
                        this.addFloatingText(target.x, target.headCenterY - 30, '💀 HEADSHOT!', '#ff3333');
                        audioManager.playHit(true);
                        this.shake += 5;
                    } else {
                        this.particles.emit(aimX, aimY, '#4488ff', 10);
                        audioManager.playHit(false);
                    }

                    if (result.killed) {
                        this.hits++;
                        this.combo++;
                        if (this.combo > this.maxCombo) this.maxCombo = this.combo;
                        this.particles.emit(target.x, target.y - target.totalHeight / 2, target.bodyColor, 25);
                        audioManager.playKill();
                    }

                    if (this.modeHandler.onHit) this.modeHandler.onHit(this, target, reactionTime, zone, result);
                    break;
                }
            } else {
                if (target.isHit(aimX, aimY)) {
                    hitAny = true;
                    target.state = 'hit';
                    const reactionTime = performance.now() - target.spawnTime;
                    this.reactionTimes.push(reactionTime);
                    if (this.modeHandler.onHit) this.modeHandler.onHit(this, target, reactionTime);
                    this.particles.emit(target.x, target.y, target.color, 20);
                    this.hits++;
                    this.combo++;
                    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

                    audioManager.playHit(false); // 普通命中音效
                    break;
                }
            }
        }

        if (!hitAny) {
            this.misses++;
            this.combo = 0;
            if (this.modeHandler.onMiss) this.modeHandler.onMiss(this);
        }

        // 查找最近的目标用于数据分析
        let nearestTarget = null;
        let minDist = Infinity;
        for (const t of this.targets) {
            if (t.state !== 'active') continue;
            const dist = (t.x - aimX) ** 2 + (t.y - aimY) ** 2;
            if (dist < minDist) {
                minDist = dist;
                nearestTarget = t;
            }
        }

        // 记录射击历史 (归一化坐标)
        this.shotHistory.push({
            x: aimX / this.canvas.width,
            y: aimY / this.canvas.height,
            tx: nearestTarget ? nearestTarget.x / this.canvas.width : 0.5,
            ty: nearestTarget ? nearestTarget.y / this.canvas.height : 0.5,
            hit: hitAny,
            t: performance.now()
        });
    }

    _startLoop() { this.animFrameId = requestAnimationFrame(this._gameLoop); }

    _stopLoop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _onKeyDown(e) {
        if (this.state !== 'running') return;

        if (keybindManager.isAction(ACTIONS.RELOAD, e)) {
            this.weapon.reload();
            return;
        }

        if (keybindManager.isAction(ACTIONS.WEAPON_1, e)) this._switchWeapon(WEAPON_PRESETS.standard);
        if (keybindManager.isAction(ACTIONS.WEAPON_2, e)) this._switchWeapon(WEAPON_PRESETS.vandal);
        if (keybindManager.isAction(ACTIONS.WEAPON_3, e)) this._switchWeapon(WEAPON_PRESETS.sheriff);
        if (keybindManager.isAction(ACTIONS.WEAPON_4, e)) this._switchWeapon(WEAPON_PRESETS.operator);

        if (keybindManager.isAction(ACTIONS.SENS_UP, e)) this.adjustSensitivity(1);
        if (keybindManager.isAction(ACTIONS.SENS_DOWN, e)) this.adjustSensitivity(-1);
    }

    adjustSensitivity(direction) {
        // 1. 获取当前配置
        const config = loadSensitivity() || getDefaultConfig();

        // 2. 计算新值
        let currentSens = config.sensitivity;
        let step = 0.05;
        if (currentSens >= 5) step = 0.5;
        else if (currentSens >= 1) step = 0.1;

        let newSens = currentSens + (direction * step);
        newSens = Math.max(0.01, Math.round(newSens * 100) / 100); // 保留两位小数

        if (newSens === currentSens) return;

        // 3. 重新计算相关参数
        const result = calculateFromGame(config.game, newSens, config.dpi);

        // 4. 更新配置对象
        const newConfig = {
            ...config,
            sensitivity: newSens,
            cm360: result.cm360,
            webSensitivity: result.webSensitivity
        };

        // 5. 应用并保存
        this.webSensitivity = result.webSensitivity;
        saveSensitivity(newConfig);

        // 6. 视觉反馈
        this.addFloatingText(
            this.canvas.width / 2,
            this.canvas.height / 2 + 100,
            `Sensitivity: ${newSens.toFixed(2)} (${result.cm360}cm)`,
            '#00fff0',
            30,
            1500
        );
        audioManager.playHit(); // 借用一下音效作为反馈
    }

    _switchWeapon(newWeapon) {
        if (newWeapon && this.weapon.name !== newWeapon.name) {
            this.weapon = newWeapon;
            this.weapon.currentAmmo = this.weapon.magazineSize;
            this.weapon.currentRecoil = { x: 0, y: 0 };
            this.weapon.isReloading = false;
            this.addFloatingText(this.crosshair.x, this.crosshair.y - 100, `Switched to ${this.weapon.name}`, '#ffffff');
        }
    }

    _gameLoop(now) {
        if (this.state !== 'running') return;

        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;
        this.elapsed += dt;

        const remaining = Math.max(0, this.duration - this.elapsed);
        if (remaining <= 0) { this.finish(); return; }

        this.targets.forEach(t => t.update(dt));
        this.particles.update(dt);
        this.weapon.update(dt);

        // 更新震动
        if (this.shake > 0) {
            this.shake *= 0.9;
            if (this.shake < 0.5) this.shake = 0;
        }

        this.floatingTexts = this.floatingTexts.filter(ft => { ft.update(dt); return !ft.isDead; });
        if (this.modeHandler.update) this.modeHandler.update(this, dt);
        this.targets = this.targets.filter(t => t.state === 'active');
        this._render();

        const accuracy = this.mode === 'tracking'
            ? (this.trackingFrames > 0 ? Math.round(this.trackingHitFrames / this.trackingFrames * 100) : 100)
            : (this.totalClicks > 0 ? Math.round(this.hits / this.totalClicks * 100) : 100);

        updateHUD({
            score: this.score,
            timer: Math.ceil(remaining),
            accuracy,
            combo: this.combo,
            ammo: this.weapon.isReloading ? 'RELOADING...' : `${this.weapon.currentAmmo}/${this.weapon.magazineSize}`,
            weapon: this.weapon.name
        });
        this.animFrameId = requestAnimationFrame(this._gameLoop);
    }

    _render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        if (this.shake > 0) {
            const dx = (Math.random() - 0.5) * this.shake;
            const dy = (Math.random() - 0.5) * this.shake;
            ctx.translate(dx, dy);
        }

        this._renderGrid(ctx, w, h);
        this._renderVignette(ctx, w, h);
        this.targets.forEach(t => t.render(ctx));
        this.particles.render(ctx);
        this.floatingTexts.forEach(ft => ft.render(ctx));
        ctx.restore(); // 结束震动偏移范围

        const originalX = this.crosshair.x;
        const originalY = this.crosshair.y;
        const recoilOffset = this.weapon.getOffset();

        this.crosshair.x += recoilOffset.x;
        this.crosshair.y += recoilOffset.y;
        this.crosshair.render(ctx);

        this.crosshair.render(ctx);

        this.crosshair.x = originalX;
        this.crosshair.y = originalY;

        // 渲染武器 (最上层)
        const time = performance.now();
        const sway = {
            x: Math.sin(time * 0.002) * 0.5,
            y: Math.cos(time * 0.004) * 0.5
        };
        // 简单的枪械回归逻辑 (Spring/Lerp)
        this.gunOffset.x *= 0.85;
        this.gunOffset.y *= 0.85;

        this.weapon.render(this.ctx, w, h, {
            time: time,
            lastFireTime: this.weapon.lastFireTime,
            gunOffset: this.gunOffset,
            sway: sway
        });
    }

    _renderGrid(ctx, w, h) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 255, 240, 0.03)';
        ctx.lineWidth = 1;
        const gs = 80;
        for (let x = 0; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.restore();
    }

    _renderVignette(ctx, w, h) {
        const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.8);
        g.addColorStop(0, 'transparent');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }

    addFloatingText(x, y, text, color = '#00fff0', fontSize = 18, durationMs = 800) {
        this.floatingTexts.push(new FloatingText(x, y, text, color, fontSize, durationMs / 1000));
    }

    pause() {
        if (this.state !== 'running') return;
        this.state = 'paused';
        this._stopLoop();
        showTrainingOverlay('已暂停', '点击画面继续 · ESC 返回菜单<br><span style="font-size: 0.8rem; color: var(--text-dim); margin-top: 1rem; display: block;">💡 按 ↑ ↓ 调整灵敏度</span>', true);

        const resumeHandler = async () => {
            this.canvas.removeEventListener('click', resumeHandler);
            await this._requestPointerLock();
            hideTrainingOverlay();
            this.state = 'running';
            this.lastTime = performance.now();
            this._startLoop();
        };
        this.canvas.addEventListener('click', resumeHandler);
    }

    finish() {
        this.state = 'finished';
        this._stopLoop();

        if (document.pointerLockElement) document.exitPointerLock();
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);

        const accuracy = this.mode === 'tracking'
            ? (this.trackingFrames > 0 ? Math.round(this.trackingHitFrames / this.trackingFrames * 100 * 10) / 10 : 100)
            : (this.totalClicks > 0 ? Math.round(this.hits / this.totalClicks * 100 * 10) / 10 : 100);

        const avgReaction = this.reactionTimes.length > 0
            ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
            : null;

        const result = {
            mode: this.mode,
            difficulty: this.difficulty,
            score: this.score,
            accuracy,
            avgReactionTime: avgReaction,
            duration: Math.round(this.elapsed),
            hits: this.hits,
            misses: this.misses,
            maxCombo: this.maxCombo,
            headshots: this.headshots,
            shotHistory: this.shotHistory
        };

        saveTrainingResult(result);
        this.generateAimTraceImage();
       showResult(result) 
       const bestScores = getBestScores();
        const previousBest = bestScores[this.mode];
        const isNewRecord = !previousBest || this.score >= previousBest.score;

        if (this.onComplete) {
            this.onComplete(result, isNewRecord);
        } else {
            showResult(result, isNewRecord,
                () => { if (this.modeHandler) this.init(this.mode, this.difficulty, this.modeHandler); },
                () => { window.app.showView('menu'); }
            );
        }
    }

generateAimTraceImage() {

    if (!this.traceHistory || this.traceHistory.length < 2) {
        return;
    }
    
    const points = this.traceHistory;

    const canvas = document.createElement('canvas');

    const size = 800;

    canvas.width = size;
    canvas.height = size;


    const ctx = canvas.getContext('2d');


    // 背景

    ctx.fillStyle = '#080812';
    ctx.fillRect(
        0,
        0,
        size,
        size
    );


    // 网格

    ctx.strokeStyle =
        'rgba(0,255,240,0.08)';

    for(let i=0;i<=size;i+=80){

        ctx.beginPath();

        ctx.moveTo(i,0);
        ctx.lineTo(i,size);

        ctx.stroke();


        ctx.beginPath();

        ctx.moveTo(0,i);
        ctx.lineTo(size,i);

        ctx.stroke();
    }



    const points =
        this.shotHistory.map(p=>({

            x:p.x*size,
            y:p.y*size,
            hit:p.hit

        }));



    // 轨迹线

    ctx.beginPath();

    ctx.lineWidth=3;

    ctx.strokeStyle='#00fff0';


    points.forEach((p,i)=>{

        if(i===0){

            ctx.moveTo(
                p.x,
                p.y
            );

        }else{

            ctx.lineTo(
                p.x,
                p.y
            );
        }

    });


    ctx.stroke();



    // 点

    points.forEach(p=>{

        ctx.beginPath();

        ctx.arc(
            p.x,
            p.y,
            5,
            0,
            Math.PI*2
        );


        ctx.fillStyle =
            p.hit
            ? '#00ff88'
            : '#ff3366';


        ctx.fill();

    });



    // 导出图片

    const img =
        canvas.toDataURL(
            "image/png"
        );


    console.log(
        "Aim trace:",
        img
    );


    // 保存到本地

   // 保存图片数据

this.lastTraceImage =
canvas.toDataURL("image/png");
);

}
   
    destroy() {
        this.state = 'idle';
        this._stopLoop();
        if (document.pointerLockElement) document.exitPointerLock();
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mousedown', this._onMouseDown);
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    }
}
