var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /**
     * @license
     *
     * DHTMLX ToDo v.1.2.3
     *
     * This software is covered by DHTMLX Evaluation License and purposed only for evaluation.
     * Contact sales@dhtmlx.com to get Commercial or Enterprise license.
     * Usage without proper license is prohibited.
     *
     * (c) XB Software.
     */
    function t(t,e){const n=["click","contextmenu"],s=n=>{!t||t.contains(n.target)||n.defaultPrevented||e(n);};return n.forEach((t=>document.addEventListener(t,s,!0))),{destroy(){n.forEach((t=>document.removeEventListener(t,s,!0)));}}}function e(t){return t&&"object"==typeof t&&!Array.isArray(t)}function n(t,s){for(const o in s){const i=s[o];e(t[o])&&e(i)?t[o]=n({...t[o]},s[o]):t[o]=s[o];}return t}function s(t){return {getGroup(e){const n=t[e];return t=>n&&n[t]||t},getRaw:()=>t,extend(e,o){if(!e)return this;let i;return i=o?n({...e},t):n({...t},e),s(i)}}}function o(){}function i(t,e){for(const n in e)t[n]=e[n];return t}function r(t){return t()}function a(){return Object.create(null)}function c(t){t.forEach(r);}function l(t){return "function"==typeof t}function d(t,e){return t!=t?e==e:t!==e||t&&"object"==typeof t||"function"==typeof t}function u(t,...e){if(null==t)return o;const n=t.subscribe(...e);return n.unsubscribe?()=>n.unsubscribe():n}function p(t,e,n){t.$$.on_destroy.push(u(e,n));}function f(t,e,n,s){if(t){const o=h(t,e,n,s);return t[0](o)}}function h(t,e,n,s){return t[1]&&s?i(n.ctx.slice(),t[1](s(e))):n.ctx}function m(t,e,n,s){if(t[2]&&s){const o=t[2](s(n));if(void 0===e.dirty)return o;if("object"==typeof o){const t=[],n=Math.max(e.dirty.length,o.length);for(let s=0;s<n;s+=1)t[s]=e.dirty[s]|o[s];return t}return e.dirty|o}return e.dirty}function g(t,e,n,s,o,i){if(o){const r=h(e,n,s,i);t.p(r,o);}}function $(t){if(t.ctx.length>32){const e=[],n=t.ctx.length/32;for(let t=0;t<n;t++)e[t]=-1;return e}return -1}function k(t){const e={};for(const n in t)"$"!==n[0]&&(e[n]=t[n]);return e}function v(t){return null==t?"":t}function y(t){return t&&l(t.destroy)?t.destroy:o}function b(t,e){t.appendChild(e);}function w(t,e,n){t.insertBefore(e,n||null);}function _(t){t.parentNode.removeChild(t);}function S(t,e){for(let n=0;n<t.length;n+=1)t[n]&&t[n].d(e);}function T(t){return document.createElement(t)}function j(t){return document.createTextNode(t)}function C(){return j(" ")}function I(){return j("")}function M(t,e,n,s){return t.addEventListener(e,n,s),()=>t.removeEventListener(e,n,s)}function D(t){return function(e){return e.stopPropagation(),t.call(this,e)}}function P(t,e,n){null==n?t.removeAttribute(e):t.getAttribute(e)!==n&&t.setAttribute(e,n);}function E(t,e){e=""+e,t.wholeText!==e&&(t.data=e);}function A(t,e,n,s){t.style.setProperty(e,n,s?"important":"");}function L(t,e,n){t.classList[n?"add":"remove"](e);}(new Date).valueOf();class F{constructor(){this.e=this.n=null;}c(t){this.h(t);}m(t,e,n=null){this.e||(this.e=T(e.nodeName),this.t=e,this.c(t)),this.i(n);}h(t){this.e.innerHTML=t,this.n=Array.from(this.e.childNodes);}i(t){for(let e=0;e<this.n.length;e+=1)w(this.t,this.n[e],t);}p(t){this.d(),this.h(t),this.i(this.a);}d(){this.n.forEach(_);}}let R;function O(t){R=t;}function z(){if(!R)throw new Error("Function called outside component initialization");return R}function H(t){z().$$.on_mount.push(t);}function q(t){z().$$.after_update.push(t);}function Y(){const t=z();return (e,n)=>{const s=t.$$.callbacks[e];if(s){const o=function(t,e,n=!1){const s=document.createEvent("CustomEvent");return s.initCustomEvent(t,n,!1,e),s}(e,n);s.slice().forEach((e=>{e.call(t,o);}));}}}function B(t,e){z().$$.context.set(t,e);}function J(t){return z().$$.context.get(t)}function W(t,e){const n=t.$$.callbacks[e.type];n&&n.slice().forEach((t=>t.call(this,e)));}const G=[],V=[],U=[],X=[],Z=Promise.resolve();let Q=!1;function K(t){U.push(t);}function tt(t){X.push(t);}let et=!1;const nt=new Set;function st(){if(!et){et=!0;do{for(let t=0;t<G.length;t+=1){const e=G[t];O(e),ot(e.$$);}for(O(null),G.length=0;V.length;)V.pop()();for(let t=0;t<U.length;t+=1){const e=U[t];nt.has(e)||(nt.add(e),e());}U.length=0;}while(G.length);for(;X.length;)X.pop()();Q=!1,et=!1,nt.clear();}}function ot(t){if(null!==t.fragment){t.update(),c(t.before_update);const e=t.dirty;t.dirty=[-1],t.fragment&&t.fragment.p(t.ctx,e),t.after_update.forEach(K);}}const it=new Set;let rt;function at(){rt={r:0,c:[],p:rt};}function ct(){rt.r||c(rt.c),rt=rt.p;}function lt(t,e){t&&t.i&&(it.delete(t),t.i(e));}function dt(t,e,n,s){if(t&&t.o){if(it.has(t))return;it.add(t),rt.c.push((()=>{it.delete(t),s&&(n&&t.d(1),s());})),t.o(e);}}const ut="undefined"!=typeof window?window:"undefined"!=typeof globalThis?globalThis:global;function pt(t,e){t.d(1),e.delete(t.key);}function ft(t,e){dt(t,1,1,(()=>{e.delete(t.key);}));}function ht(t,e,n,s,o,i,r,a,c,l,d,u){let p=t.length,f=i.length,h=p;const m={};for(;h--;)m[t[h].key]=h;const g=[],$=new Map,k=new Map;for(h=f;h--;){const t=u(o,i,h),a=n(t);let c=r.get(a);c?s&&c.p(t,e):(c=l(a,t),c.c()),$.set(a,g[h]=c),a in m&&k.set(a,Math.abs(h-m[a]));}const x=new Set,v=new Set;function y(t){lt(t,1),t.m(a,d),r.set(t.key,t),d=t.first,f--;}for(;p&&f;){const e=g[f-1],n=t[p-1],s=e.key,o=n.key;e===n?(d=e.first,p--,f--):$.has(o)?!r.has(s)||x.has(s)?y(e):v.has(o)?p--:k.get(s)>k.get(o)?(v.add(s),y(e)):(x.add(o),p--):(c(n,r),p--);}for(;p--;){const e=t[p];$.has(e.key)||c(e,r);}for(;f;)y(g[f-1]);return g}function mt(t,e,n){const s=t.$$.props[e];void 0!==s&&(t.$$.bound[s]=n,n(t.$$.ctx[s]));}function gt(t){t&&t.c();}function $t(t,e,n,s){const{fragment:o,on_mount:i,on_destroy:a,after_update:d}=t.$$;o&&o.m(e,n),s||K((()=>{const e=i.map(r).filter(l);a?a.push(...e):c(e),t.$$.on_mount=[];})),d.forEach(K);}function kt(t,e){const n=t.$$;null!==n.fragment&&(c(n.on_destroy),n.fragment&&n.fragment.d(e),n.on_destroy=n.fragment=null,n.ctx=[]);}function xt(t,e){-1===t.$$.dirty[0]&&(G.push(t),Q||(Q=!0,Z.then(st)),t.$$.dirty.fill(0)),t.$$.dirty[e/31|0]|=1<<e%31;}function vt(t,e,n,s,i,r,l,d=[-1]){const u=R;O(t);const p=t.$$={fragment:null,ctx:null,props:r,update:o,not_equal:i,bound:a(),on_mount:[],on_destroy:[],on_disconnect:[],before_update:[],after_update:[],context:new Map(e.context||(u?u.$$.context:[])),callbacks:a(),dirty:d,skip_bound:!1,root:e.target||u.$$.root};l&&l(p.root);let f=!1;if(p.ctx=n?n(t,e.props||{},((e,n,...s)=>{const o=s.length?s[0]:n;return p.ctx&&i(p.ctx[e],p.ctx[e]=o)&&(!p.skip_bound&&p.bound[e]&&p.bound[e](o),f&&xt(t,e)),n})):[],p.update(),f=!0,c(p.before_update),p.fragment=!!s&&s(p.ctx),e.target){if(e.hydrate){const t=function(t){return Array.from(t.childNodes)}(e.target);p.fragment&&p.fragment.l(t),t.forEach(_);}else p.fragment&&p.fragment.c();e.intro&&lt(t.$$.fragment),$t(t,e.target,e.anchor,e.customElement),st();}O(u);}class yt{$destroy(){kt(this,1),this.$destroy=o;}$on(t,e){const n=this.$$.callbacks[t]||(this.$$.callbacks[t]=[]);return n.push(e),()=>{const t=n.indexOf(e);-1!==t&&n.splice(t,1);}}$set(t){var e;this.$$set&&(e=t,0!==Object.keys(e).length)&&(this.$$.skip_bound=!0,this.$$set(t),this.$$.skip_bound=!1);}}function bt(t,e="data-id"){let n=t;for(!n.tagName&&t.target&&(n=t.target);n;){if(n.getAttribute){if(n.getAttribute(e))return n}n=n.parentNode;}return null}function wt(t){if("string"==typeof t){const e=1*t;if(!isNaN(e))return e}return t}function _t(t,e){let n=null;t.addEventListener("click",(function(t){const s=bt(t);if(!s)return;const o=wt(s.dataset.id);let i,r=t.target;for(;r!=s;){if(i=r.dataset?r.dataset.action:null,i){e[i]&&e[i](o,t),n=(new Date).valueOf();break}r=r.parentNode;}e.click&&!i&&e.click(o,t);})),t.addEventListener("dblclick",(function(t){if(n&&(new Date).valueOf()-n<200)return;const s=function(t,e="data-id"){const n=bt(t,e);return n?wt(n.getAttribute(e)):null}(t);s&&e.dblclick&&e.dblclick(s,t);}));}function St(t){return t&&"object"==typeof t&&!Array.isArray(t)}function Tt(t,e){for(const n in e){const s=e[n];St(t[n])&&St(s)?t[n]=Tt({...t[n]},e[n]):t[n]=e[n];}return t}function jt(t){return {getGroup(e){const n=t[e];return t=>n&&n[t]||t},getRaw:()=>t,extend(e,n){if(!e)return this;let s;return s=n?Tt({...e},t):Tt({...t},e),jt(s)}}}(new Date).valueOf();function Pt(t){let e;return {c(){e=T("span"),P(e,"class","spacer svelte-1w5macl");},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function Et(t){let e,n,s;return {c(){e=T("i"),P(e,"class","pager wxi-angle-left svelte-1w5macl");},m(o,i){w(o,e,i),n||(s=M(e,"click",t[8]),n=!0);},p:o,d(t){t&&_(e),n=!1,s();}}}function Nt(t){let e;return {c(){e=T("span"),P(e,"class","spacer svelte-1w5macl");},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function At(t){let e,n,s;return {c(){e=T("i"),P(e,"class","pager wxi-angle-right svelte-1w5macl");},m(o,i){w(o,e,i),n||(s=M(e,"click",t[9]),n=!0);},p:o,d(t){t&&_(e),n=!1,s();}}}function Lt(t){let e,n,s,i,r,a,c;function l(t,e){return "right"!=t[1]?Et:Pt}let d=l(t),u=d(t);function p(t,e){return "left"!=t[1]?At:Nt}let f=p(t),h=f(t);return {c(){e=T("div"),u.c(),n=C(),s=T("span"),i=j(t[2]),r=C(),h.c(),P(s,"class","label svelte-1w5macl"),P(e,"class","header svelte-1w5macl");},m(o,l){w(o,e,l),u.m(e,null),b(e,n),b(e,s),b(s,i),b(e,r),h.m(e,null),a||(c=M(s,"click",t[4]),a=!0);},p(t,[s]){d===(d=l(t))&&u?u.p(t,s):(u.d(1),u=d(t),u&&(u.c(),u.m(e,n))),4&s&&E(i,t[2]),f===(f=p(t))&&h?h.p(t,s):(h.d(1),h=f(t),h&&(h.c(),h.m(e,null)));},i:o,o:o,d(t){t&&_(e),u.d(),h.d(),a=!1,c();}}}function Ft(t,e,n){const s=Y(),o=J("wx-i18n").getRaw().calendar.monthFull;let i,r,a,{date:c}=e,{type:l}=e,{part:d}=e;return t.$$set=t=>{"date"in t&&n(5,c=t.date),"type"in t&&n(0,l=t.type),"part"in t&&n(1,d=t.part);},t.$$.update=()=>{if(225&t.$$.dirty)switch(n(6,i=c.getMonth()),n(7,r=c.getFullYear()),l){case"month":n(2,a=`${o[i]} ${r}`);break;case"year":n(2,a=r);break;case"duodecade":{const t=r-r%10;n(2,a=`${t} - ${t+9}`);break}}},[l,d,a,s,function(){s("shift",{diff:0,type:l});},c,i,r,()=>s("shift",{diff:-1,type:l}),()=>s("shift",{diff:1,type:l})]}class Rt extends yt{constructor(t){super(),vt(this,t,Ft,Lt,d,{date:5,type:0,part:1});}}function Ot(t){let e,n,s,o;const i=t[2].default,r=f(i,t,t[1],null);return {c(){e=T("button"),r&&r.c(),P(e,"class","svelte-1bjiwod");},m(i,a){w(i,e,a),r&&r.m(e,null),n=!0,s||(o=M(e,"click",(function(){l(t[0])&&t[0].apply(this,arguments);})),s=!0);},p(e,[s]){t=e,r&&r.p&&(!n||2&s)&&g(r,i,t,t[1],n?m(i,t[1],s,null):$(t[1]),null);},i(t){n||(lt(r,t),n=!0);},o(t){dt(r,t),n=!1;},d(t){t&&_(e),r&&r.d(t),s=!1,o();}}}function zt(t,e,n){let{$$slots:s={},$$scope:o}=e,{click:i}=e;return t.$$set=t=>{"click"in t&&n(0,i=t.click),"$$scope"in t&&n(1,o=t.$$scope);},[i,o,s]}class Ht extends yt{constructor(t){super(),vt(this,t,zt,Ot,d,{click:0});}}function qt(t,e,n){const s=t.slice();return s[17]=e[n],s}function Yt(t,e,n){const s=t.slice();return s[17]=e[n],s}function Bt(t){let e,n,s=t[17]+"";return {c(){e=T("div"),n=j(s),P(e,"class","weekday svelte-1al976d");},m(t,s){w(t,e,s),b(e,n);},p:o,d(t){t&&_(e);}}}function Jt(t,e){let n,s,o,i,r,a=e[17].day+"";return {key:t,first:null,c(){n=T("div"),s=j(a),o=C(),P(n,"class",i="day "+e[17].css+" svelte-1al976d"),P(n,"data-id",r=e[17].date),L(n,"out",!e[17].in),this.first=n;},m(t,e){w(t,n,e),b(n,s),b(n,o);},p(t,o){e=t,1&o&&a!==(a=e[17].day+"")&&E(s,a),1&o&&i!==(i="day "+e[17].css+" svelte-1al976d")&&P(n,"class",i),1&o&&r!==(r=e[17].date)&&P(n,"data-id",r),1&o&&L(n,"out",!e[17].in);},d(t){t&&_(n);}}}function Wt(t){let e,n,s,i,r,a,c=[],l=new Map,d=t[1],u=[];for(let e=0;e<d.length;e+=1)u[e]=Bt(Yt(t,d,e));let p=t[0];const f=t=>t[17].date;for(let e=0;e<p.length;e+=1){let n=qt(t,p,e),s=f(n);l.set(s,c[e]=Jt(s,n));}return {c(){e=T("div"),n=T("div");for(let t=0;t<u.length;t+=1)u[t].c();s=C(),i=T("div");for(let t=0;t<c.length;t+=1)c[t].c();P(n,"class","weekdays svelte-1al976d"),P(i,"class","days svelte-1al976d");},m(o,l){w(o,e,l),b(e,n);for(let t=0;t<u.length;t+=1)u[t].m(n,null);b(e,s),b(e,i);for(let t=0;t<c.length;t+=1)c[t].m(i,null);r||(a=y(_t.call(null,i,t[2])),r=!0);},p(t,[e]){if(2&e){let s;for(d=t[1],s=0;s<d.length;s+=1){const o=Yt(t,d,s);u[s]?u[s].p(o,e):(u[s]=Bt(o),u[s].c(),u[s].m(n,null));}for(;s<u.length;s+=1)u[s].d(1);u.length=d.length;}1&e&&(p=t[0],c=ht(c,e,f,1,t,p,l,i,pt,Jt,null,qt));},i:o,o:o,d(t){t&&_(e),S(u,t);for(let t=0;t<c.length;t+=1)c[t].d();r=!1,a();}}}function Gt(t){const e=t.getDay();return 0===e||6===e}function Vt(t,e,n){let{value:s}=e,{current:o}=e,{cancel:i}=e,{select:r}=e,{part:a}=e,{markers:c=null}=e;const l=J("wx-i18n").getRaw().calendar,d=(l.weekStart||7)%7,u=l.dayShort.slice(d).concat(l.dayShort.slice(0,d));let p,f;const h=(t,e,n)=>new Date(t.getFullYear(),t.getMonth()+(e||0),t.getDate()+(n||0));let m="normal"!==a;const g={click:function(t,e){r&&(e.stopPropagation(),r(new Date(new Date(t))));i&&i();}};return t.$$set=t=>{"value"in t&&n(3,s=t.value),"current"in t&&n(4,o=t.current),"cancel"in t&&n(5,i=t.cancel),"select"in t&&n(6,r=t.select),"part"in t&&n(7,a=t.part),"markers"in t&&n(8,c=t.markers);},t.$$.update=()=>{if(921&t.$$.dirty){n(9,f="normal"==a?[s?h(s).valueOf():0]:s?[s.start?h(s.start).valueOf():0,s.end?h(s.end).valueOf():0]:[0,0]);const t=function(){const t=h(o,0,1-o.getDate());return t.setDate(t.getDate()-(t.getDay()-(d-7))%7),t}(),e=function(){const t=h(o,1,-o.getDate());return t.setDate(t.getDate()+(6-t.getDay()+d)%7),t}(),i=o.getMonth();n(0,p=[]);for(let n=t;n<=e;n.setDate(n.getDate()+1)){const t={day:n.getDate(),in:n.getMonth()===i,date:n.valueOf()};let e="";if(e+=t.in?"":" inactive",e+=f.indexOf(t.date)>-1?" selected":"",m){const n=t.date==f[0],s=t.date==f[1];n&&!s?e+=" left":s&&!n&&(e+=" right"),t.date>f[0]&&t.date<f[1]&&(e+=" inrange");}if(e+=Gt(n)?" weekend":"",c){const t=c(n);t&&(e+=" "+t);}p.push({...t,css:e});}}},[p,u,g,s,o,i,r,a,c,f]}function Ut(t,e,n){const s=t.slice();return s[9]=e[n],s[11]=n,s}function Xt(t){let e,n,s,i=t[9]+"";return {c(){e=T("div"),n=j(i),s=C(),P(e,"class","month svelte-zfj0z0"),P(e,"data-id",t[11]),L(e,"current",t[1]===t[11]);},m(t,o){w(t,e,o),b(e,n),b(e,s);},p(t,n){2&n&&L(e,"current",t[1]===t[11]);},d(t){t&&_(e);}}}function Zt(t){let e,n=t[2].done+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function Qt(t){let e,n,s,o,i,r,a,c=t[3],l=[];for(let e=0;e<c.length;e+=1)l[e]=Xt(Ut(t,c,e));return o=new Ht({props:{click:t[0],$$slots:{default:[Zt]},$$scope:{ctx:t}}}),{c(){e=T("div");for(let t=0;t<l.length;t+=1)l[t].c();n=C(),s=T("div"),gt(o.$$.fragment),P(e,"class","months svelte-zfj0z0"),P(s,"class","buttons svelte-zfj0z0");},m(c,d){w(c,e,d);for(let t=0;t<l.length;t+=1)l[t].m(e,null);w(c,n,d),w(c,s,d),$t(o,s,null),i=!0,r||(a=y(_t.call(null,e,t[4])),r=!0);},p(t,[n]){if(10&n){let s;for(c=t[3],s=0;s<c.length;s+=1){const o=Ut(t,c,s);l[s]?l[s].p(o,n):(l[s]=Xt(o),l[s].c(),l[s].m(e,null));}for(;s<l.length;s+=1)l[s].d(1);l.length=c.length;}const s={};1&n&&(s.click=t[0]),4096&n&&(s.$$scope={dirty:n,ctx:t}),o.$set(s);},i(t){i||(lt(o.$$.fragment,t),i=!0);},o(t){dt(o.$$.fragment,t),i=!1;},d(t){t&&_(e),S(l,t),t&&_(n),t&&_(s),kt(o),r=!1,a();}}}function Kt(t,e,n){let{value:s}=e,{current:o}=e,{cancel:i}=e,{part:r}=e;const a=J("wx-i18n").getRaw().calendar,c=a.monthShort;let l;const d={click:function(t){(t||0===t)&&(o.setMonth(t),n(6,o));"normal"===r&&n(5,s=new Date(o));i();}};return t.$$set=t=>{"value"in t&&n(5,s=t.value),"current"in t&&n(6,o=t.current),"cancel"in t&&n(0,i=t.cancel),"part"in t&&n(7,r=t.part);},t.$$.update=()=>{224&t.$$.dirty&&("normal"!==r&&s?"left"===r&&s.start?n(1,l=s.start.getMonth()):"right"===r&&s.end?n(1,l=s.end.getMonth()):n(1,l=o.getMonth()):n(1,l=o.getMonth()));},[i,l,a,c,d,s,o,r]}function te(t,e,n){const s=t.slice();return s[9]=e[n],s[11]=n,s}function ee(t){let e,n,s,o,i=t[9]+"";return {c(){e=T("div"),n=j(i),s=C(),P(e,"class","year svelte-ia304r"),P(e,"data-id",o=t[9]),L(e,"current",t[2]==t[9]),L(e,"prev-decade",0===t[11]),L(e,"next-decade",11===t[11]);},m(t,o){w(t,e,o),b(e,n),b(e,s);},p(t,s){2&s&&i!==(i=t[9]+"")&&E(n,i),2&s&&o!==(o=t[9])&&P(e,"data-id",o),6&s&&L(e,"current",t[2]==t[9]);},d(t){t&&_(e);}}}function ne(t){let e,n=t[3].done+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function se(t){let e,n,s,o,i,r,a,c=t[1],l=[];for(let e=0;e<c.length;e+=1)l[e]=ee(te(t,c,e));return o=new Ht({props:{click:t[0],$$slots:{default:[ne]},$$scope:{ctx:t}}}),{c(){e=T("div");for(let t=0;t<l.length;t+=1)l[t].c();n=C(),s=T("div"),gt(o.$$.fragment),P(e,"class","years svelte-ia304r"),P(s,"class","buttons svelte-ia304r");},m(c,d){w(c,e,d);for(let t=0;t<l.length;t+=1)l[t].m(e,null);w(c,n,d),w(c,s,d),$t(o,s,null),i=!0,r||(a=y(_t.call(null,e,t[4])),r=!0);},p(t,[n]){if(6&n){let s;for(c=t[1],s=0;s<c.length;s+=1){const o=te(t,c,s);l[s]?l[s].p(o,n):(l[s]=ee(o),l[s].c(),l[s].m(e,null));}for(;s<l.length;s+=1)l[s].d(1);l.length=c.length;}const s={};1&n&&(s.click=t[0]),4096&n&&(s.$$scope={dirty:n,ctx:t}),o.$set(s);},i(t){i||(lt(o.$$.fragment,t),i=!0);},o(t){dt(o.$$.fragment,t),i=!1;},d(t){t&&_(e),S(l,t),t&&_(n),t&&_(s),kt(o),r=!1,a();}}}function oe(t,e,n){const s=J("wx-i18n").getRaw().calendar;let o,i,{value:r}=e,{current:a}=e,{cancel:c}=e,{part:l}=e;const d={click:function(t){t&&(a.setFullYear(t),n(5,a));"normal"===l&&n(6,r=new Date(a));c();}};return t.$$set=t=>{"value"in t&&n(6,r=t.value),"current"in t&&n(5,a=t.current),"cancel"in t&&n(0,c=t.cancel),"part"in t&&n(7,l=t.part);},t.$$.update=()=>{if(38&t.$$.dirty){n(2,i=a.getFullYear());const t=i-i%10-1,e=t+12;n(1,o=[]);for(let n=t;n<e;++n)o.push(n);}},[c,o,i,s,d,a,r,l]}const ie={month:{component:class extends yt{constructor(t){super(),vt(this,t,Vt,Wt,d,{value:3,current:4,cancel:5,select:6,part:7,markers:8});}},next:function(t){return (t=new Date(t)).setMonth(t.getMonth()+1),t},prev:function(t){let e=new Date(t);e.setMonth(t.getMonth()-1);for(;t.getMonth()===e.getMonth();)e.setDate(e.getDate()-1);return e}},year:{component:class extends yt{constructor(t){super(),vt(this,t,Kt,Qt,d,{value:5,current:6,cancel:0,part:7});}},next:function(t){return (t=new Date(t)).setFullYear(t.getFullYear()+1),t},prev:function(t){return (t=new Date(t)).setFullYear(t.getFullYear()-1),t}},duodecade:{component:class extends yt{constructor(t){super(),vt(this,t,oe,se,d,{value:6,current:5,cancel:0,part:7});}},next:function(t){return (t=new Date(t)).setFullYear(t.getFullYear()+10),t},prev:function(t){return (t=new Date(t)).setFullYear(t.getFullYear()-10),t}}};function re(t){let e,n,s,o,i,r,a,c,l=t[2]&&ae(t);return o=new Ht({props:{click:t[14],$$slots:{default:[le]},$$scope:{ctx:t}}}),a=new Ht({props:{click:t[15],$$slots:{default:[de]},$$scope:{ctx:t}}}),{c(){e=T("div"),l&&l.c(),n=C(),s=T("div"),gt(o.$$.fragment),i=C(),r=T("div"),gt(a.$$.fragment),P(s,"class","button-item svelte-14q6rsg"),P(r,"class","button-item svelte-14q6rsg"),P(e,"class","buttons svelte-14q6rsg");},m(t,d){w(t,e,d),l&&l.m(e,null),b(e,n),b(e,s),$t(o,s,null),b(e,i),b(e,r),$t(a,r,null),c=!0;},p(t,s){t[2]?l?(l.p(t,s),4&s&&lt(l,1)):(l=ae(t),l.c(),lt(l,1),l.m(e,n)):l&&(at(),dt(l,1,1,(()=>{l=null;})),ct());const i={};131072&s&&(i.$$scope={dirty:s,ctx:t}),o.$set(i);const r={};131072&s&&(r.$$scope={dirty:s,ctx:t}),a.$set(r);},i(t){c||(lt(l),lt(o.$$.fragment,t),lt(a.$$.fragment,t),c=!0);},o(t){dt(l),dt(o.$$.fragment,t),dt(a.$$.fragment,t),c=!1;},d(t){t&&_(e),l&&l.d(),kt(o),kt(a);}}}function ae(t){let e,n,s;return n=new Ht({props:{click:t[13],$$slots:{default:[ce]},$$scope:{ctx:t}}}),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","button-item svelte-14q6rsg");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},p(t,e){const s={};131072&e&&(s.$$scope={dirty:e,ctx:t}),n.$set(s);},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function ce(t){let e,n=t[7]("done")+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function le(t){let e,n=t[7]("clear")+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function de(t){let e,n=t[7]("today")+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function ue(t){let e,n,s,o,i,r,a,c,l;s=new Rt({props:{date:t[1],part:t[3],type:t[6]}}),s.$on("shift",t[12]);var d=ie[t[6]].component;function u(t){return {props:{value:t[0],current:t[1],part:t[3],markers:t[4],select:t[11],cancel:t[9]}}}d&&(r=new d(u(t)));let p="month"===t[6]&&t[5]&&re(t);return {c(){e=T("div"),n=T("div"),gt(s.$$.fragment),o=C(),i=T("div"),r&&gt(r.$$.fragment),a=C(),p&&p.c(),P(n,"class","wrap svelte-14q6rsg"),P(e,"class",c="calendar "+("normal"!==t[3]?"part":"")+" svelte-14q6rsg");},m(t,c){w(t,e,c),b(e,n),$t(s,n,null),b(n,o),b(n,i),r&&$t(r,i,null),b(i,a),p&&p.m(i,null),l=!0;},p(t,[n]){const o={};2&n&&(o.date=t[1]),8&n&&(o.part=t[3]),64&n&&(o.type=t[6]),s.$set(o);const f={};if(1&n&&(f.value=t[0]),2&n&&(f.current=t[1]),8&n&&(f.part=t[3]),16&n&&(f.markers=t[4]),d!==(d=ie[t[6]].component)){if(r){at();const t=r;dt(t.$$.fragment,1,0,(()=>{kt(t,1);})),ct();}d?(r=new d(u(t)),gt(r.$$.fragment),lt(r.$$.fragment,1),$t(r,i,a)):r=null;}else d&&r.$set(f);"month"===t[6]&&t[5]?p?(p.p(t,n),96&n&&lt(p,1)):(p=re(t),p.c(),lt(p,1),p.m(i,null)):p&&(at(),dt(p,1,1,(()=>{p=null;})),ct()),(!l||8&n&&c!==(c="calendar "+("normal"!==t[3]?"part":"")+" svelte-14q6rsg"))&&P(e,"class",c);},i(t){l||(lt(s.$$.fragment,t),r&&lt(r.$$.fragment,t),lt(p),l=!0);},o(t){dt(s.$$.fragment,t),r&&dt(r.$$.fragment,t),dt(p),l=!1;},d(t){t&&_(e),kt(s),r&&kt(r),p&&p.d();}}}function pe(t,e,n){const s=Y(),o=J("wx-i18n").getGroup("calendar");let{value:i}=e,{current:r}=e,{done:a=!1}=e,{part:c="normal"}=e,{markers:l=null}=e,{buttons:d=!0}=e,u="month";function p(t,e){t.preventDefault(),s("change",{value:e});}function f(t){0==t.diff?"month"===u?n(6,u="year"):"year"===u&&n(6,u="duodecade"):s("shift",t);}return t.$$set=t=>{"value"in t&&n(0,i=t.value),"current"in t&&n(1,r=t.current),"done"in t&&n(2,a=t.done),"part"in t&&n(3,c=t.part),"markers"in t&&n(4,l=t.markers),"buttons"in t&&n(5,d=t.buttons);},[i,r,a,c,l,d,u,o,p,function(){"duodecade"===u?n(6,u="year"):"year"===u&&n(6,u="month");},f,function(t){s("change",{select:!0,value:t});},t=>f(t.detail),t=>p(t,-1),t=>p(t,null),t=>p(t,new Date)]}class fe extends yt{constructor(t){super(),vt(this,t,pe,ue,d,{value:0,current:1,done:2,part:3,markers:4,buttons:5});}}function he(t){let e,n;return e=new fe({props:{value:t[0],current:t[1],markers:t[2],buttons:t[3]}}),e.$on("shift",t[6]),e.$on("change",t[7]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,[n]){const s={};1&n&&(s.value=t[0]),2&n&&(s.current=t[1]),4&n&&(s.markers=t[2]),8&n&&(s.buttons=t[3]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function me(t,e,n){const s=Y();let{value:o}=e,{current:i}=e,{markers:r=null}=e,{buttons:a=!0}=e;function c({diff:t,type:e}){const s=ie[e];n(1,i=t>0?s.next(i):s.prev(i));}function l(t){const e=t.value;e?(n(1,i=new Date(e)),n(0,o=new Date(e))):n(0,o=null),s("change",{value:o});}return t.$$set=t=>{"value"in t&&n(0,o=t.value),"current"in t&&n(1,i=t.current),"markers"in t&&n(2,r=t.markers),"buttons"in t&&n(3,a=t.buttons);},t.$$.update=()=>{1&t.$$.dirty&&(i||n(1,i=o||new Date));},[o,i,r,a,c,l,t=>c(t.detail),t=>l(t.detail)]}class ge extends yt{constructor(t){super(),vt(this,t,me,he,d,{value:0,current:1,markers:2,buttons:3});}}const{document:$e}=ut;function ke(t){let e,n,s,o,i;const r=t[8].default,a=f(r,t,t[7],null);return {c(){e=C(),n=T("div"),a&&a.c(),P(n,"class","popup svelte-3iw5hi"),A(n,"top",t[1]+"px"),A(n,"left",t[0]+"px");},m(r,c){w(r,e,c),w(r,n,c),a&&a.m(n,null),t[9](n),s=!0,o||(i=M($e.body,"mousedown",t[3]),o=!0);},p(t,[e]){a&&a.p&&(!s||128&e)&&g(a,r,t,t[7],s?m(r,t[7],e,null):$(t[7]),null),(!s||2&e)&&A(n,"top",t[1]+"px"),(!s||1&e)&&A(n,"left",t[0]+"px");},i(t){s||(lt(a,t),s=!0);},o(t){dt(a,t),s=!1;},d(s){s&&_(e),s&&_(n),a&&a.d(s),t[9](null),o=!1,i();}}}function xe(t,e,n){let s,{$$slots:o={},$$scope:i}=e,{left:r=0}=e,{top:a=0}=e,{area:c=null}=e,{cancel:l}=e,{mount:d}=e;function u(){if(!s)return;const t=document.body.getBoundingClientRect(),e=s.getBoundingClientRect();e.right>=t.right&&n(0,r=t.right-e.width),e.bottom>=t.bottom&&n(1,a=t.bottom-e.height-12);}return c&&(d&&d(u),q((()=>u()))),t.$$set=t=>{"left"in t&&n(0,r=t.left),"top"in t&&n(1,a=t.top),"area"in t&&n(4,c=t.area),"cancel"in t&&n(5,l=t.cancel),"mount"in t&&n(6,d=t.mount),"$$scope"in t&&n(7,i=t.$$scope);},t.$$.update=()=>{16&t.$$.dirty&&c&&(n(1,a=c.top+c.height),n(0,r=c.left));},[r,a,s,function(t){s.contains(t.target)||l&&l(t);},c,l,d,i,o,function(t){V[t?"unshift":"push"]((()=>{s=t,n(2,s);}));}]}class ve extends yt{constructor(t){super(),vt(this,t,xe,ke,d,{left:0,top:1,area:4,cancel:5,mount:6});}}const ye=t=>({}),be=t=>({mount:t[1]});function we(t){let e,n,s,o;const i=t[5].default,r=f(i,t,t[4],be);return {c(){e=T("div"),n=T("div"),r&&r.c(),P(n,"class",s="wx-"+t[0]+"-theme svelte-nejz1p"),P(e,"class","wx-clone svelte-nejz1p");},m(s,i){w(s,e,i),b(e,n),r&&r.m(n,null),t[6](n),o=!0;},p(t,[e]){r&&r.p&&(!o||16&e)&&g(r,i,t,t[4],o?m(i,t[4],e,ye):$(t[4]),be),(!o||1&e&&s!==(s="wx-"+t[0]+"-theme svelte-nejz1p"))&&P(n,"class",s);},i(t){o||(lt(r,t),o=!0);},o(t){dt(r,t),o=!1;},d(n){n&&_(e),r&&r.d(n),t[6](null);}}}function _e(t,e,n){let s,{$$slots:o={},$$scope:i}=e,{theme:r=""}=e,{target:a}=e,c=[];var l;return ""===r&&(r=J("wx-theme")),H((()=>{(a||function(t){for(;;){if(t===document.body||t.getAttribute("data-wx-portal-root"))return t;t=t.parentNode;}}(s)).appendChild(s),c&&c.forEach((t=>t()));})),l=()=>{s&&s.parentNode&&s.parentNode.removeChild(s);},z().$$.on_destroy.push(l),t.$$set=t=>{"theme"in t&&n(0,r=t.theme),"target"in t&&n(3,a=t.target),"$$scope"in t&&n(4,i=t.$$scope);},[r,t=>{c&&c.push(t);},s,a,i,o,function(t){V[t?"unshift":"push"]((()=>{s=t,n(2,s);}));}]}class Se extends yt{constructor(t){super(),vt(this,t,_e,we,d,{theme:0,target:3,mount:1});}get mount(){return this.$$.ctx[1]}}function Te(t){let e,n;return {c(){e=new F,n=I(),e.a=n;},m(t,s){e.m("<style>\n@font-face {\nfont-family: 'Roboto';\nfont-style: normal;\nfont-weight: 400;\nsrc: local(''),\n    url('https://cdn.webix.com/fonts/roboto/regular.woff2') format('woff2'),\n    url('https://cdn.webix.com/fonts/roboto/regular.woff') format('woff');\n}\n@font-face {\nfont-family: 'Roboto';\nfont-style: normal;\nfont-weight: 500;\nsrc: local(''),\n    url('https://cdn.webix.com/fonts/roboto/500.woff2') format('woff2'),\n    url('https://cdn.webix.com/fonts/roboto/500.woff') format('woff');\n}</style>",t,s),w(t,n,s);},p:o,i:o,o:o,d(t){t&&_(n),t&&e.d();}}}class je extends yt{constructor(t){super(),vt(this,t,null,Te,d,{});}}function Ce(t){let e,n,s,o,i,r;return s=new je({}),{c(){e=T("link"),n=C(),gt(s.$$.fragment),o=C(),i=T("link"),P(e,"rel","preconnect"),P(e,"href","https://cdn.webix.com"),P(e,"crossorigin",""),P(i,"rel","stylesheet"),P(i,"href","https://webix.io/dev/fonts/wxi/wx-icons.css");},m(t,a){w(t,e,a),w(t,n,a),$t(s,t,a),w(t,o,a),w(t,i,a),r=!0;},i(t){r||(lt(s.$$.fragment,t),r=!0);},o(t){dt(s.$$.fragment,t),r=!1;},d(t){t&&_(e),t&&_(n),kt(s,t),t&&_(o),t&&_(i);}}}function Ie(t){let e,n,s,o=t[1]&&t[1].default&&function(t){let e,n;const s=t[3].default,o=f(s,t,t[2],null);return {c(){e=T("div"),o&&o.c(),P(e,"class","wx-material-theme"),A(e,"height","100%");},m(t,s){w(t,e,s),o&&o.m(e,null),n=!0;},p(t,e){o&&o.p&&(!n||4&e)&&g(o,s,t,t[2],n?m(s,t[2],e,null):$(t[2]),null);},i(t){n||(lt(o,t),n=!0);},o(t){dt(o,t),n=!1;},d(t){t&&_(e),o&&o.d(t);}}}(t),i=t[0]&&Ce();return {c(){o&&o.c(),e=C(),i&&i.c(),n=I();},m(t,r){o&&o.m(t,r),w(t,e,r),i&&i.m(document.head,null),b(document.head,n),s=!0;},p(t,[e]){t[1]&&t[1].default&&o.p(t,e),t[0]?i?1&e&&lt(i,1):(i=Ce(),i.c(),lt(i,1),i.m(n.parentNode,n)):i&&(at(),dt(i,1,1,(()=>{i=null;})),ct());},i(t){s||(lt(o),lt(i),s=!0);},o(t){dt(o),dt(i),s=!1;},d(t){o&&o.d(t),t&&_(e),i&&i.d(t),_(n);}}}function Me(t,e,n){let{$$slots:s={},$$scope:o}=e,{fonts:r=!0}=e;const a=e.$$slots;return B("wx-theme","material"),t.$$set=t=>{n(4,e=i(i({},e),k(t))),"fonts"in t&&n(0,r=t.fonts),"$$scope"in t&&n(2,o=t.$$scope);},e=k(e),[r,a,o,s]}class De extends yt{constructor(t){super(),vt(this,t,Me,Ie,d,{fonts:0});}}const Pe={core:{ok:"OK",cancel:"Cancel"},calendar:{monthFull:["January","February","March","April","May","June","July","August","September","October","November","December"],monthShort:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],dayFull:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],dayShort:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],hours:"Hours",minutes:"Minutes",done:"Done",clear:"Clear",today:"Today",am:["am","AM"],pm:["pm","PM"],weekStart:7,timeFormat:24}};function Ee(t){let e;const n=t[3].default,s=f(n,t,t[2],null);return {c(){s&&s.c();},m(t,n){s&&s.m(t,n),e=!0;},p(t,[o]){s&&s.p&&(!e||4&o)&&g(s,n,t,t[2],e?m(n,t[2],o,null):$(t[2]),null);},i(t){e||(lt(s,t),e=!0);},o(t){dt(s,t),e=!1;},d(t){s&&s.d(t);}}}function Ne(t,e,n){let{$$slots:s={},$$scope:o}=e,{words:i=null}=e,{optional:r=!1}=e,a=J("wx-i18n");return a||(a=jt(Pe)),a=a.extend(i,r),B("wx-i18n",a),t.$$set=t=>{"words"in t&&n(0,i=t.words),"optional"in t&&n(1,r=t.optional),"$$scope"in t&&n(2,o=t.$$scope);},[i,r,o,s]}class Ae extends yt{constructor(t){super(),vt(this,t,Ne,Ee,d,{words:0,optional:1});}}function Le(t){let e,n;const s=t[1].default,o=f(s,t,t[2],null);return {c(){e=T("div"),o&&o.c(),P(e,"class","wx-material-theme"),A(e,"height","100%"),A(e,"width","100%");},m(t,s){w(t,e,s),o&&o.m(e,null),n=!0;},p(t,e){o&&o.p&&(!n||4&e)&&g(o,s,t,t[2],n?m(s,t[2],e,null):$(t[2]),null);},i(t){n||(lt(o,t),n=!0);},o(t){dt(o,t),n=!1;},d(t){t&&_(e),o&&o.d(t);}}}function Fe(t){let e,n,s=t[0]&&t[0].default&&function(t){let e,n;return e=new De({props:{$$slots:{default:[Le]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};4&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}(t);return {c(){s&&s.c(),e=I();},m(t,o){s&&s.m(t,o),w(t,e,o),n=!0;},p(t,[e]){t[0]&&t[0].default&&s.p(t,e);},i(t){n||(lt(s),n=!0);},o(t){dt(s),n=!1;},d(t){s&&s.d(t),t&&_(e);}}}function Re(t,e,n){let{$$slots:s={},$$scope:o}=e;const r=e.$$slots;return t.$$set=t=>{n(3,e=i(i({},e),k(t))),"$$scope"in t&&n(2,o=t.$$scope);},e=k(e),[r,s,o]}class Oe extends yt{constructor(t){super(),vt(this,t,Re,Fe,d,{});}}const ze={core:{ok:"OK",cancel:"Cancel"},calendar:{monthFull:["January","February","March","April","May","June","July","August","September","October","November","December"],monthShort:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],dayFull:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],dayShort:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],hours:"Hours",minutes:"Minutes",done:"Done",clear:"Clear",today:"Today",am:["am","AM"],pm:["pm","PM"],weekStart:7,timeFormat:24}};var He={todo:{"No project":"No project","Search project":"Search project","Add project":"Add project","Rename project":"Rename project","Delete project":"Delete project","Completed tasks":"Completed tasks",Show:"Show",Hide:"Hide","Sort by":"Sort by","Text (a-z)":"Text (a-z)","Text (z-a)":"Text (z-a)","Due date (new to old)":"Due date (new to old)","Due date (old to new)":"Due date (old to new)","Completion date (new to old)":"Completion date (new to old)","Completion date (old to new)":"Completion date (old to new)","Created (new to old)":"Created (new to old)","Created (old to new)":"Created (old to new)","Edited (new to old)":"Edited (new to old)","Edited (old to new)":"Edited (old to new)","Priority (high to low)":"Priority (high to low)","Priority (low to high)":"Priority (low to high)","Add task below":"Add task below","Add subtask":"Add subtask","Set due date":"Set due date","Set priority":"Set priority","Reset priority":"Reset priority",Indent:"Indent",Unindent:"Unindent","Assign to":"Assign to","Move to":"Move to",Duplicate:"Duplicate",Copy:"Copy",Paste:"Paste",Delete:"Delete",Enter:"Enter",Tab:"Tab","Shift+Tab":"Shift+Tab","Ctrl+D":"Ctrl+D","Ctrl+C":"Ctrl+C","Ctrl+V":"Ctrl+V","CMD+D":"CMD+D","CMD+C":"CMD+C","CMD+V":"CMD+V","Type what you want":"Type what you want",Search:"Search","Add task":"Add task","New project":"New project",High:"High",Medium:"Medium",Low:"Low"}};let qe=(new Date).valueOf();const Ye=()=>qe++;class Be{constructor(t,e,n){this._setter=t,this._routes=e,this._parsers=n,this._prev={},this._triggers=new Map,this._sources=new Map,this._routes.forEach((t=>{t.in.forEach((e=>{const n=this._triggers.get(e)||[];n.push(t),this._triggers.set(e,n);})),t.out.forEach((e=>{const n=this._sources.get(e)||{};t.in.forEach((t=>n[t]=!0)),this._sources.set(e,n);}));})),this._routes.forEach((t=>{t.length=Math.max(...t.in.map((t=>Je(t,this._sources,1))));}));}init(t){const e={};for(const n in t)if(this._prev[n]!==t[n]){const s=this._parsers[n];e[n]=s?s(t[n]):t[n];}this._prev=this._prev?{...this._prev,...t}:{...t},this.setState(e);}setState(t,e){this._setter(t);const n=!e;e=e||[];for(const n in t){const t=this._triggers.get(n);t&&t.forEach((t=>{-1==e.indexOf(t)&&e.push(t);}));}n&&this._execNext(e);}_execNext(t){for(;t.length;){t.sort(((t,e)=>t.length<e.length?1:-1));const e=t[t.length-1];t.splice(t.length-1),e.exec(t);}}}function Je(t,e,n){const s=e.get(t);if(!s)return n;const o=Object.keys(s).map((t=>Je(t,e,n+1)));return Math.max(...o)}class We{constructor(){this._nextHandler=()=>null,this._handlers={},this.exec=this.exec.bind(this);}on(t,e){const n=this._handlers[t];this._handlers[t]=n?function(t){Ge(n,t)(e(t));}:n=>{Ge(this._nextHandler,n,t)(e(n));};}exec(t,e){const n=this._handlers[t];n?n(e):this._nextHandler(t,e);}setNext(t){this._nextHandler=t;}}function Ge(t,e,n){return s=>{!1!==s&&(s&&s.then?s.then(Ge(t,e,n)):n?t(n,e):t(e));}}class Ve{constructor(t){this._nextHandler=()=>null,this._dispatch=t,this.exec=this.exec.bind(this);}exec(t,e){this._dispatch(t,e),this._nextHandler&&this._nextHandler(t,e);}setNext(t){this._nextHandler=t;}}let Ue=(new Date).valueOf();function Xe(){return Ue+=1,"temp://"+Ue}function Ze(t,e){return t==e}function Qe(t){return null!=t}function Ke(t){return null===t}function tn(t,e){const n=t.length;for(let s=0;s<n;s++)if(e(t[s]))return s;return -1}function en(t){return /\s/g.test(t)}function nn(){return navigator.userAgent.indexOf("Mac")>-1}function sn(t){if(!t)return t;const e=Array.isArray(t)?[]:{};for(const n in t){const s=t[n];s instanceof Date?e[n]=new Date(s):e[n]="object"==typeof s?sn(s):s;}return e}function on(t){return t.flatMap((({children:t,...e})=>[e,...on(t||[])]))}function rn(){(function(){if("undefined"==typeof window)return !0;const t=location.hostname,e=["ZGh0bWx4LmNvbQ==","ZGh0bWx4Y29kZS5jb20=","d2ViaXhjb2RlLmNvbQ==","d2ViaXguaW8=","cmVwbC5jbw==","Y3NiLmFwcA=="];for(let n=0;n<e.length;n++){const s=window.atob(e[n]);if(s===t||t.endsWith("."+s))return !0}return !1})()||setTimeout((()=>{var t,e;setInterval((()=>{if("undefined"!=typeof window&&new Date>process.env.TRIALDATE){!function(t){const e=document.createElement("div");e.setAttribute("style","\n\t\tdisplay:block!important;\n\t\tbackground: #ff5252 !important;\n\t\tcolor: white !important;\n\t\tpadding: 12px;\n\t\tposition: absolute !important;\n\t\tmax-width: 260px;top: 2% !important;\n\t\tright: 2% !important;\n\t\tfont-size: 14px !important;\n\t\tbox-shadow: 0 1px 6px rgba(0,0,0,.1), 0 10px 20px rgba(0,0,0,.1);\n\t\tcursor: pointer;\n\t\tborder-radius: 2px;\n\t\tfont-family: Roboto, Arial, Helvetica, sans-serif;\n\t\tz-index: 999999;"),e.innerText=t,e.addEventListener("click",(function(){document.body.removeChild(e),window.open("https://dhtmlx.com/docs/products/licenses.shtml","_blank");})),document.body.appendChild(e);}(window.atob("WW91ciB0cmlhbCBoYXMgZXhwaXJlZC4gUGxlYXNlIHB1cmNoYXNlIHRoZSBjb21tZXJjaWFsIGxpY2Vuc2UgZm9yIHRoZSBUb0RvIExpc3Qgd2lkZ2V0IGF0IGh0dHBzOi8vZGh0bWx4LmNvbQ=="));}}),(t=6e4,e=18e4,Math.floor(Math.random()*(e-t+1))+t));}));}const an=["#607D8B","#00C7B5","#03A9F4","#9575CD","#F06292","#FF9800"],cn=["#ff5252","#ffc975","#0ab169","#607D8B","#00C7B5","#03A9F4","#9575CD","#F06292","#FF9800"],ln={counter:{type:"number"},date:{format:"%d %M %Y",validate:!0},completed:{behavior:"auto",taskHide:!1},priority:{label:!0,cover:!0}},dn={expand:!0},un=[{id:1,label:"High",color:"#ff5252",hotkey:"Alt+1"},{id:2,label:"Medium",color:"#ffc975",hotkey:"Alt+2"},{id:3,label:"Low",color:"#0ab169",hotkey:"Alt+3"}],pn=t=>new RegExp(String.raw`(?:^|)${t}(?:\s|$)`,"gm"),fn=t=>new RegExp(String.raw`\B[${t}]\w\S+`,"gm");function hn(t,e,n){if(n){const n=pn(e);return !!t.match(n)?.length}return t.toLowerCase().includes(e.toLowerCase())}function mn(t=[],e){return t.map((t=>({...t,children:mn(t.children,e)}))).filter((t=>function(t,{match:e,by:n,strict:s}){return hn(n?t[n]||"":t.text||"",e,s)}(t,e)||t?.children?.length))}function gn(t){return on(function(t){const e={},n=[],s={};for(let n=0;n<t.length;n++)s[t[n].id]=n,e[t[n].id]=[],t[n].children=[];for(let o=0;o<t.length;o++){const i=t[o];i.parent&&e[i.parent]?(t[s[i.parent]].children.push(i),e[i.parent].push(i)):Qe(i.parent)||n.push(i);}return n}(t))}function $n(t,e,n){if(t?.children?.length)for(let s=0;s<t.children.length;s++)$n(t.children[s],e,n);t.counter={type:n?.counter?.type||"number",total:e[t.id].length,done:e[t.id].filter((t=>!0===t.checked)).length};}function kn(t,e){const n=[];for(let s=0;s<e.assigned.length;s++){const o=t[e.assigned[s]];o.type="user",o&&n.push(o);}return n}function xn(t){const{menu:e,stateEditableItem:n,stateDueDate:s,stateCombo:o}=t.getState();e&&t.in.exec("close-menu",{...e}),n&&t.in.exec("close-inline-editor",{id:n.id,save:!0}),s?.open&&t.in.exec("set-state-due-date",{...s,open:!1}),o?.open&&t.in.exec("set-state-due-date",{...s,open:!1});}function vn(t,{id:e,project:n,parent:s,targetId:o,task:i={},reverse:r}){if(t.existsTask(e))return;const a=t.getState(),{activeProject:c,tasksMap:l}=a;i.id=e??i.id??Xe().toString(),void 0!==n?i.project=n:void 0===i.project&&Qe(c)&&(i.project=c),void 0!==s&&(i.parent=s),i.creation_date=new Date;let{tasks:d}=a;l[e]=i,d=[...d,i];const{treeTasks:u,childrenMap:p,filteredChildrenMap:f,usersMap:h,tags:m}=t.getInnerState(d,c);t.setState({tasks:d,treeTasks:u,childrenMap:p,filteredChildrenMap:f,usersMap:h,tags:m,tasksMap:l}),(Qe(o)||r)&&t.moveTask({id:i.id,parent:i.parent,project:i.project,targetId:o,reverse:r,silent:!0});}function yn(t,{id:e,task:n,skipStateCalc:s=!1}){t.updateTask({id:e,task:n,skipStateCalc:s});}function bn(t,{id:e,parent:n,targetId:s,reverse:o,project:i}){xn(t),t.moveTask({id:e,parent:n,targetId:s,reverse:o,project:i});}function wn(t,{id:e,targetId:n,parent:s,reverse:o,project:i,join:r=!1}){if(!t.existsTask(e))return;let a=[];if(r){const n=t.getState().copiedTasksId,s=t.getParentIds(e);if(n.some((t=>Ze(t,e)||s.some((e=>Ze(t,e))))))return;const o=t.getChildrenIds({id:e});for(let t=0;t<n.length;t++)o.some((e=>Ze(e,n[t])))&&n.splice(t,1);a=[...n];}a.push(e),t.setState({copiedTasksId:a}),(t.existsTask(n)||t.existsTask(s)||Ke(s))&&t.pasteTask({targetId:n,parent:s,project:i,reverse:o});}function _n(t,{targetId:e,parent:n,project:s,reverse:o}){t.pasteTask({targetId:e,parent:n,project:s,reverse:o});}function Sn(t,{id:e}){if(!t.existsTask(e))return;const n=t.getState();let{selected:s,tasks:o}=n;const i=n.tasksMap,r=[e,...t.getChildrenIds({id:e,tree:!0})];for(const t of r)s=s.filter((e=>!Ze(e,t))),o=o.filter((e=>!Ze(e.id,t))),delete i[t];const{treeTasks:a,childrenMap:c,filteredChildrenMap:l,usersMap:d,tags:u}=t.getInnerState(o,n.activeProject);t.setState({tasks:o,treeTasks:a,childrenMap:c,filteredChildrenMap:l,usersMap:d,tags:u,selected:s,tasksMap:i});}function Tn(t,{id:e}){const n=t.getTask(e);n?.collapsed&&t.in.exec("update-task",{id:e,task:{...n,collapsed:!1},skipProvider:!0});}function jn(t,{id:e}){const n=t.getTask(e);n?.collapsed||t.in.exec("update-task",{id:e,task:{...n,collapsed:!0},skipProvider:!0});}function Cn(t,{id:e,manual:n=!1,skipStateCalc:s=!1}){const o=t.getTask(e);if(o?.checked)return;const i=[],r=t.getState().taskShape?.completed?.behavior||"auto";if(!n&&"manual"!==r&&!s){t.hasChildren(e)&&t.getChildren({id:e,tree:!0}).forEach((e=>{e.checked||(t.in.exec("check-task",{id:e.id,skipStateCalc:!0}),i.push(t.getTask(e.id)));}));t.getParentIds(e).forEach((n=>{const s=t.getChildren({id:n}).every((n=>!!Ze(n.id,e)||t.getTask(n.id).checked));if(s){t.getTask(n).checked||(t.in.exec("check-task",{id:n,skipStateCalc:!0}),i.push(t.getTask(n)));}}));}o.checked=!0,o.completion_date=new Date,t.in.exec("update-task",{id:e,task:o,skipStateCalc:s,skipProvider:s&&!n,batch:i});}function In(t,{id:e,manual:n=!1,skipStateCalc:s=!1}){const o=t.getTask(e);if(!o?.checked)return;const i=[],r=t.getState().taskShape?.completed?.behavior||"auto";n||"manual"===r||s||(Qe(o.parent)&&t.getParentIds(e).forEach((e=>{t.getTask(e).checked&&(t.in.exec("uncheck-task",{id:e,skipStateCalc:!0}),i.push(t.getTask(e)));})),t.hasChildren(e)&&t.getChildren({id:e,tree:!0}).forEach((e=>{e.checked&&(t.in.exec("uncheck-task",{id:e.id,skipStateCalc:!0}),i.push(t.getTask(e.id)));}))),o.checked=!1,delete o.completion_date,t.in.exec("update-task",{id:e,task:o,skipStateCalc:s,skipProvider:s&&!n,batch:i});}function Mn(t,{id:e,batchID:n}){const s=t.getTask(e),o=t.getTask(s?.parent),i=t.getState(),r=Qe(i.filter?.match),a=i?.taskShape?.completed?.taskHide,c=t.getChildren({id:o?.id,tree:!1,filtered:r,hideCompleted:a}),l=t.getTreeIndex(e,r,a);if(l>0){const s=t.getTask(c[l-1]?.id);t.in.exec("move-task",{id:e,parent:s?.id,targetId:s?.id,operation:"indent",batchID:n}),s.collapsed&&t.in.exec("expand-task",{id:s?.id});}}function Dn(t,{id:e,batchID:n}){const s=t.getTask(e),o=t.getTask(s?.parent);Qe(o?.id)&&t.in.exec("move-task",{id:e,parent:o.parent??null,targetId:o.id,operation:"unindent",batchID:n});}function Pn(t){const{taskShape:e}=t.getState();e.completed.taskHide=!1,t.setState({taskShape:e});}function En(t){const{taskShape:e}=t.getState();e.completed.taskHide=!0,t.setState({taskShape:e});}function Nn(t,{id:e,join:n=!1}){let{selected:s}=t.getState();if(!(!t.existsTask(e)||n&&s.some((t=>Ze(t,e))))){if(n)s.push(e);else {for(const n of s)Ze(n,e)||t.in.exec("unselect-task",{id:n});s=[e];}t.updateTask({id:e,task:{selected:!0}}),t.setState({selected:s});}}function An(t,{id:e}){let{selected:n}=t.getState();if(n.length&&(!Qe(e)||n.some((t=>Ze(t,e))))){if(Qe(e))t.updateTask({id:e,task:{selected:!1}});else {for(const e of n)t.in.exec("unselect-task",{id:e});n=[];}n=n.filter((t=>!Ze(t,e))),xn(t),t.setState({selected:n});}}function Ln(t,{id:e,project:n}){if(t.existsProject(e))return;n={id:e??Ye().toString(),label:"New project",...n};const s=[...t.getState().projects,n];t.setState({projects:s});}function Fn(t,{id:e,project:n}){if(!t.existsProject(e))return;const s=t.getState().projects.map((t=>Ze(e,t.id)?{...t,...n,id:t.id}:t));t.setState({projects:s});}function Rn(t,{id:e}){if(!t.existsProject(e)&&!Ke(e)||void 0===e)return;xn(t);const{treeTasks:n,childrenMap:s,filteredChildrenMap:o}=t.getInnerState(t.getState().tasks,e);t.setState({activeProject:e,treeTasks:n,childrenMap:s,filteredChildrenMap:o});}function On(t,{id:e}){if(!t.existsProject(e))return;const n=t.getState(),s=n.projects.filter((t=>!Ze(t.id,e)));n.tasks.forEach((n=>(Ze(n.project,e)&&t.in.exec("update-task",{id:n.id,task:{...n,project:null},skipProvider:!0,skipStateCalc:!0}),n)));const o=n.tasks,{treeTasks:i,childrenMap:r,filteredChildrenMap:a}=t.getInnerState(o,n.activeProject);t.setState({projects:s,treeTasks:i,tasks:o,childrenMap:r,filteredChildrenMap:a}),Ze(n.activeProject,e)&&(s.length?t.in.exec("set-project",{id:s[0].id}):t.in.exec("set-project",{id:null}));}let zn={monthFull:["January","February","March","April","May","June","July","August","September","October","November","December"],monthShort:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],dayFull:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],dayShort:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]};const Hn={"%d":t=>{const e=t.getDate();return e<10?"0"+e:e},"%j":t=>t.getDate(),"%l":t=>zn.dayFull[t.getDay()],"%D":t=>zn.dayShort[t.getDay()],"%m":t=>{const e=t.getMonth()+1;return e<10?"0"+e:e},"%n":t=>t.getMonth()+1,"%M":t=>zn.monthShort[t.getMonth()],"%F":t=>zn.monthFull[t.getMonth()],"%y":t=>t.getFullYear().toString().slice(2),"%Y":t=>t.getFullYear()},qn={"%d":(t,e)=>{/(^([0-9][0-9])$)/i.test(e)?t.setDate(Number(e)):t.setDate(Number(1));},"%j":(t,e)=>{/(^([0-9]?[0-9])$)/i.test(e)?t.setDate(Number(e)):t.setDate(Number(1));},"%m":(t,e)=>{const n=/(^([0-9][0-9])$)/i.test(e);n?t.setMonth(Number(e)-1):t.setMonth(Number(0)),n&&t.getMonth()!==Number(e)-1&&t.setMonth(Number(e)-1);},"%n":(t,e)=>{const n=/(^([0-9]?[0-9])$)/i.test(e);n?t.setMonth(Number(e)-1):t.setMonth(Number(0)),n&&t.getMonth()!==Number(e)-1&&t.setMonth(Number(e)-1);},"%M":(t,e)=>{const n=tn(zn.monthShort,(t=>t===e));-1===n?t.setMonth(0):t.setMonth(n),-1!==n&&t.getMonth()!==n&&t.setMonth(n);},"%F":(t,e)=>{const n=tn(zn.monthFull,(t=>t===e));-1===n?t.setMonth(0):t.setMonth(n),-1!==n&&t.getMonth()!==n&&t.setMonth(n);},"%y":(t,e)=>{/(^([0-9][0-9])$)/i.test(e)?t.setFullYear(Number("20"+e)):t.setFullYear(Number("2000"));},"%Y":(t,e)=>{/(^([0-9][0-9][0-9][0-9])$)/i.test(e)?t.setFullYear(Number(e)):t.setFullYear(Number("2000"));}};var Yn;function Bn(t){const e=[];let n="";for(let s=0;s<t.length;s++)"%"===t[s]?(n.length>0&&(e.push({type:Yn.separator,value:n}),n=""),e.push({type:Yn.datePart,value:t[s]+t[s+1]}),s++):n+=t[s];return n.length>0&&e.push({type:Yn.separator,value:n}),e}function Jn(t,e,n){return n&&(zn=n),Bn(e).reduce(((e,n)=>n.type===Yn.separator?e+n.value:Hn[n.value]?e+Hn[n.value](t):e),"")}function Wn(t,e,n=!1,s){if("string"!=typeof t)return;s&&(zn=s);const o=Bn(e),i=[];let r,a=0,c=null;for(const e of o)if(e.type===Yn.separator){const s=t.indexOf(e.value,a);if(-1===s){if(n)return !1;if(Gn(t))return new Date(t);throw new Error("Incorrect Date or date format")}c&&(i.push({formatter:c,value:t.slice(a,s)}),c=null),a=s+e.value.length;}else e.type===Yn.datePart&&(c=e.value);"%A"===c||"%a"===c?i.unshift({formatter:c,value:t.slice(a)}):c&&i.push({formatter:c,value:t.slice(a)}),i.reverse();for(const t of i)"%A"!==t.formatter&&"%a"!==t.formatter||(r=t.value);const l=new Date(0);for(const t of i)qn[t.formatter]&&qn[t.formatter](l,t.value,r);return l}function Gn(t){if("string"==typeof t){return new RegExp("^(-?(?:[1-9][0-9]*)?[0-9]{4})-(1[0-2]|0[1-9])-(3[01]|0[1-9]|[12][0-9])T(2[0-3]|[01][0-9]):([0-5][0-9]):([0-5][0-9])(.[0-9]+)?(Z)?$").test(t)}return t instanceof Date}function Vn({store:t,type:e,id:n,source:s}){switch(e){case"task":return function(t,e=[]){const{filter:n,projects:s,users:o,taskShape:i,priorities:r}=t.getState(),a=e.at(0),c=i?.date?.format,l=[];let d=t.getTask(a)?.due_date;"string"==typeof d&&(d=Wn(d,c));Qe(n)||1!==e.length||l.push({type:"item",icon:"plus",label:"Add task below",hotkey:"Enter",id:"addBellow"},{type:"item",icon:"subtask",label:"Add subtask",id:"addSubtask"},{type:"separator"});l.push({type:"item",icon:"indent",label:"Indent",hotkey:"Tab",id:"indent"},{type:"item",icon:"unindent",label:"Unindent",hotkey:"Shift+Tab",id:"unindent"},{type:"item",icon:"calendar",label:"Set due date",id:"setDate",data:[{type:"datepicker",id:"dueDate",value:1===e.length&&d?d:null,store:t}]}),Array.isArray(r)&&r.length&&l.push({type:"item",icon:"alert",label:"Set priority",data:Zn(t,a,r),id:"setPriority"});1===e.length&&o?.length&&l.push({type:"item",icon:"assign",label:"Assign to",data:Un(t,a,"assign"),id:"assign"});s?.length&&l.push({type:"item",icon:"content-paste",label:"Move to",data:Xn(t,"moveProject"),id:"moveProject"});return [...l,{type:"item",icon:"duplicate",label:"Duplicate",hotkey:nn()?"CMD+D":"Ctrl+D",id:"duplicate"},{type:"item",icon:"content-copy",label:"Copy",hotkey:nn()?"CMD+C":"Ctrl+C",id:"copy"},{type:"item",icon:"paste",label:"Paste",hotkey:nn()?"CMD+V":"Ctrl+V",id:"paste"},{type:"separator"},{type:"item",icon:"delete",label:"Delete",hotkey:"Delete",id:"delete"}]}(t,s);case"toolbar":return function(t,e){const{taskShape:n,readonly:s}=t.getState(),o=n?.completed?.taskHide||!1,i=[{id:"sort",type:"item",label:"Sort by",icon:"sort",data:[{id:"sort:text-asc",type:"item",label:"Text (a-z)",icon:"asc"},{id:"sort:text-desc",type:"item",label:"Text (z-a)",icon:"desc"},{type:"separator"},{id:"sort:priority-asc",type:"item",label:"Priority (high to low)",icon:"asc"},{id:"sort:priority-desc",type:"item",label:"Priority (low to high)",icon:"desc"},{type:"separator"},{id:"sort:due-date-desc",type:"item",label:"Due date (new to old)",icon:"asc"},{id:"sort:due-date-asc",type:"item",label:"Due date (old to new)",icon:"desc"},{type:"separator"},{id:"sort:completion-date-desc",type:"item",label:"Completion date (new to old)",icon:"asc"},{id:"sort:completion-date-asc",type:"item",label:"Completion date (old to new)",icon:"desc"},{type:"separator"},{id:"sort:created-date-desc",type:"item",label:"Created (new to old)",icon:"asc"},{id:"sort:created-date-asc",type:"item",label:"Created (old to new)",icon:"desc"},{type:"separator"},{id:"sort:edited-date-desc",type:"item",label:"Edited (new to old)",icon:"asc"},{id:"sort:edited-date-asc",type:"item",label:"Edited (old to new)",icon:"desc"}]},{id:"completed",icon:"check",label:"Completed tasks",type:"item",data:[{id:"completed:show",label:"Show",type:"item",icon:o?"empty":"check"},{id:"completed:hide",label:"Hide",type:"item",icon:o?"check":"empty"}]}];s||(i.push({type:"separator"},{id:"add",icon:"plus",label:"Add project",type:"item"}),Qe(e)&&i.push({id:"rename",icon:"edit",label:"Rename project",type:"item"},{id:"delete",icon:"delete",label:"Delete project",type:"item"}));return i}(t,n)}}function Un(t,e,n){const s=sn(t.getState().users),o=t.getTask(e),i=[];if(s.length)for(let t=0;t<s.length;t++){const e=s[t],r=o?.assigned?.some((t=>Ze(t,e.id)));i.push({...e,id:n+":"+e.id,color:e.color||an[t%an.length],icon:r?"check":"empty",type:"user",clicable:!0,checked:r});}return i}function Xn(t,e){const n=t.getState().activeProject;let s=sn(t.getState().projects);s.every((t=>Qe(t.id)))&&(s=[{id:null,label:"No project"},...s]);const o=[];if(s.length)for(let t=0;t<s.length;t++){const i=s[t],r=Ze(i.id,n);o.push({...i,id:e+":"+i.id,type:"item",icon:r?"check":"empty",checked:r});}return o}function Zn(t,e,n){const s=t.getTask(e),o=[];for(let t=0;t<n.length;t++){const e=n[t];o.push({...e,id:"priority:"+e.id,type:"priority",hotkey:e.hotkey,color:e.color||cn[t%cn.length],icon:Ze(s?.priority,e.id)?"check":"empty"});}return [...o,{type:"separator"},{type:"item",icon:"refresh",label:"Reset priority",hotkey:"Alt+0",id:"priority:reset"}]}function Qn(t,{id:e,type:n,source:s}){Qe(n)&&t.setState({menu:{id:e,type:n,source:s,options:Vn({store:t,type:n,id:e,source:s})}});}function Kn(t){t.setState({menu:null});}function ts({store:t,id:e}){const n=Qe(t.getState()?.filter),s=t.getState()?.taskShape?.completed?.taskHide,o=t.getTask(e),i=t.getChildrenIds({id:o?.parent,tree:!0,filtered:n,hideCompleted:s});let r=null;return r=(!Qe(o?.parent)||1!==i.length&&i.at(-1)!==o.id)&&t.getNearId({id:o.id,flat:!0,filtered:n,hideCompleted:s})||t.getNearId({id:o.id,dir:"prev",flat:!0,filtered:n,hideCompleted:s}),r}function es(t,e,n,s,o){Ze(e,t.getTask(n)?.project)||void 0===e||(t.in.exec("select-task",{id:ts({store:t,id:n})}),t.in.exec("move-task",{id:n,project:e,parent:null,operation:"project",skipProvider:o,batch:s}));}function ns({store:t,task:e,reverse:n=!1}){const s=Xe().toString();t.in.exec("add-task",{id:s,targetId:e?.id,parent:e?.parent,project:t.getState()?.activeProject,reverse:n}),t.in.exec("select-task",{id:s}),t.in.exec("open-inline-editor",{id:s,type:"task"});}function ss({store:t}){const e=t.getState().selected;if(!e.length)return;let n=ts({store:t,id:e.at(-1)});t.getTask(n)?.selected&&(n=ts({store:t,id:e.at(0)})),t.eachSelected((e=>{t.existsTask(e)&&t.in.exec("delete-task",{id:e});}),!0),t.in.exec("select-task",{id:n});}function os({store:t,id:e}){const n=t.getState().copiedTasksId;e=e||n.at(-1),t.in.exec("paste-task",{targetId:e,parent:t.getTask(e)?.parent??null});}function is({store:t}){const{selected:e}=t.getState();t.eachSelected(((n,s)=>{t.in.exec("copy-task",{id:n,join:!!s}),e.length-1===s&&os({store:t});}),!0);}function rs({store:t}){t.eachSelected(((e,n)=>{t.in.exec("copy-task",{id:e,join:!!n});}),!0);}function as({store:t}){const e=Xe();t.eachSelected((n=>{t.getTask(t.getTask(n).parent)?.selected||t.in.exec("indent-task",{id:n,batchID:e});}),!0);}function cs({store:t}){const e=Xe();t.eachSelected((n=>{t.getTask(t.getTask(n).parent)?.selected||t.in.exec("unindent-task",{id:n,batchID:e});}),!0);}function ls({store:t,priority:e}){t.getState().selected.length&&(e="null"===e||"0"==e?null:+e,t.eachSelected((n=>{const s=t.getTask(n);t.in.exec("update-task",{id:n,task:{...s,priority:e}});})));}function ds(t,e,n){const{menu:s}=t.getState(),o=n?.split(":"),i=o?.at(0);if(i){const n=t.getTask(e);let r=o.at(1);switch(i){case"addBellow":ns({store:t,task:n});break;case"addSubtask":ns({store:t,task:{...n,parent:e,targetId:e}}),n?.collapsed&&t.hasChildren(e)&&t.in.exec("expand-task",{id:e});break;case"duplicate":is({store:t});break;case"delete":ss({store:t});break;case"indent":as({store:t});break;case"unindent":cs({store:t});break;case"copy":rs({store:t});break;case"paste":os({store:t,id:e});break;case"priority":ls({store:t,priority:r});break;case"assign":n?.assigned?.some((t=>Ze(t,r)))?t.in.exec("unassign-user",{id:e,userId:r}):t.in.exec("assign-user",{id:e,userId:r}),t.setState({menu:{...t.getState().menu,options:Vn({store:t,type:"task",source:s.source})}});break;case"moveProject":"null"===r&&(r=null),function({store:t,id:e}){const n=t.getSelection({sorted:!0}),s=n.filter((e=>{const s=t.getTask(e);return !n.some((e=>Ze(t.getTask(e).id,s.parent)))}));for(let o=0;o<n.length;o++){const i=n[o];es(t,e,i,s,!!o);}}({store:t,id:r});}}"assign"!==i&&t.in.exec("close-menu",{...s});}function us(t){const e={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"};return t.replace(/[&<>"]/g,(t=>e[t]))}function ps(t,e){if(!t)return "";let n=us(t);return e?.highlight?n=function(t,e){const n=e?.strict?pn(e.match):new RegExp(e.match,"gi"),s=e?.strict?"wx-todo_filter--strict":"wx-todo_filter";return t.replace(n,(t=>`<mark class="${s}">${t}</mark>`))}(n,e):(n=function(t){return t.replace(fn("#"),(t=>`<span class="wx-todo_tag" data-tag="${t}">${t}</span>`))}(n),n=function(t){const e=new RegExp(/!\((.+?)\)/gm);return t.replace(e,(t=>{const e=t.substring(2,t.length-1);return `<span class="wx-todo_date" data-date="${e}">${e}</span>`}))}(n)),n}function fs(t,e,n){const s=e.filter((e=>e.label.includes(n(t))));if(!s.length)return n(t);const o=new RegExp(/\d+(?=\))/gm);let i=0;for(const{label:t}of s){const e=t.match(o);e&&+e[0]>i&&(i=+e[0]);}return `${n(t)} (${i+1})`}function hs(t,{action:e,id:n,locate:s}){const{projects:o,menu:i}=t.getState();if(e){const i=e.split(":"),r=i.at(0),a=i.at(1);switch(r){case"sort":!function(t,e){switch(e){case"text-asc":t.in.exec("set-sort",{by:"text",dir:"asc",tree:!0});break;case"text-desc":t.in.exec("set-sort",{by:"text",dir:"desc",tree:!0});break;case"due-date-asc":t.in.exec("set-sort",{by:"due_date",dir:"asc",tree:!0});break;case"due-date-desc":t.in.exec("set-sort",{by:"due_date",dir:"desc",tree:!0});break;case"completion-date-asc":t.in.exec("set-sort",{by:"completion_date",dir:"asc",tree:!0});break;case"completion-date-desc":t.in.exec("set-sort",{by:"completion_date",dir:"desc",tree:!0});break;case"created-date-asc":t.in.exec("set-sort",{by:"creation_date",dir:"asc",tree:!0});break;case"created-date-desc":t.in.exec("set-sort",{by:"creation_date",dir:"desc",tree:!0});break;case"edited-date-asc":t.in.exec("set-sort",{by:"edited_date",dir:"asc",tree:!0});break;case"edited-date-desc":t.in.exec("set-sort",{by:"edited_date",dir:"desc",tree:!0});break;case"priority-asc":t.in.exec("set-sort",{by:"priority",dir:"asc",tree:!0});break;case"priority-desc":t.in.exec("set-sort",{by:"priority",dir:"desc",tree:!0});}}(t,a);break;case"completed":!function(t,e){switch(e){case"show":t.in.exec("show-completed-tasks",{});break;case"hide":t.in.exec("hide-completed-tasks",{});}}(t,a);break;case"add":!function(t,e){const n=e?.id||Xe().toString();t.in.exec("add-project",{id:n,project:{label:e?.label||"New project"}}),t.in.exec("set-project",{id:n}),t.in.exec("open-inline-editor",{id:n,type:"project"});}(t,{id:"temp://"+Ye(),label:fs("New project",o,s)});break;case"rename":t.in.exec("open-inline-editor",{id:n,type:"project"});break;case"delete":t.in.exec("delete-project",{id:n});}}t.in.exec("close-menu",{...i});}function ms(t,{id:e,action:n,type:s,params:o}){switch(s){case"task":return void ds(t,e,n);case"toolbar":return void hs(t,{id:e,action:n,locate:o.locate})}}function gs(t,{id:e,userId:n}){if(!t.getState().usersMap[n?.toString()])return;const s=t.getTask(e);s?.assigned?.some((t=>Ze(t,n)))||t.in.exec("update-task",{id:e,task:{...s,assigned:s?.assigned?.length?[...s.assigned,n]:[n]}});}function $s(t,{id:e,userId:n}){const s=t.getTask(e);s?.assigned?.some((t=>Ze(t,n)))&&t.in.exec("update-task",{id:e,task:{...s,assigned:s?.assigned?.filter((t=>t!=n))}});}function ks(t,{id:e,type:n="task",targetDate:s}){const{stateDueDate:o}=t.getState();if(o?.open||!Qe(e)||!t.existsTask(e)&&"task"===n||!t.existsProject(e)&&"project"===n)return;let i=null;"task"===n?i=t.getTask(e)?.text:"project"===n&&(i=t.getProject(e)?.label),t.setState({stateEditableItem:{id:e,type:n,initValue:i,currentValue:i,targetDate:s}});}function xs(t,{save:e=!0}){const{stateEditableItem:n}=t.getState();if(!Qe(n?.id))return;const s=n.id,o=n.currentValue;if(e){if("task"===n.type){const e=t.getTask(s);o!==e.text&&(e.text=o,e.edited_date=new Date,t.in.exec("update-task",{id:s,task:e}));}if("project"===n.type){const e=t.getProject(s);o!==e.label&&(e.label=o,t.in.exec("update-project",{id:s,project:e}));}}t.setState({stateEditableItem:null});}function vs(t,{currentValue:e,dropdown:n,targetDate:s}){const{stateEditableItem:o}=t.getState();t.setState({stateEditableItem:{...o,currentValue:e,dropdown:n,targetDate:s}});}function ys(t,e="data-id"){let n=t;if(t?.changedTouches){const{clientX:e,clientY:s}=t.changedTouches[0];n=document.elementFromPoint(e,s);}else !t.tagName&&t.target&&(n=t.target);for(;n;){if(n.getAttribute){if(n.getAttribute(e))return n}n=n.parentNode;}return null}function bs(t,e="data-id"){const n=ys(t,e);return n?function(t,e="data-id"){const n=t.getAttribute(e),s=parseInt(n);return isNaN(s)||s.toString()!=n?n:s}(n,e):null}function ws(t,e){if(t){if(t?.childNodes[0]){const n=document.createRange(),s=window.getSelection();let o=t?.childNodes[t?.childNodes.length-1];const i=o?.textContent?.length;let r=i;if("number"==typeof e){const n=t.childNodes;for(let t=0;t<n.length;t++){const s=n[t],i=s.textContent.length;if(i>=e){r=e,o=s;break}e-=i;}}n.setStart(o,r),n.collapse(!0),s.removeAllRanges(),s.addRange(n);}setTimeout((()=>t.focus()));}}function _s({store:t,id:e}){const n=t.getTask(e);if(!n||n.checked)return;const{taskShape:s}=t.getState();if(s?.completed?.taskHide){let n=null;const s=t.getParentIds(e),o=s[s.length-1],i=t.getChildren({filtered:!0,hideCompleted:!0}),r=i.findIndex((t=>Ze(t.id,o)));if(n=ts({store:t,id:e}),t.in.exec("check-task",{id:e}),t.getTask(o)?.checked){const t=i[r+1]?.id,e=i[r-1]?.id;n=Qe(t)?t:e;}else t.getTask(n)?.checked&&(n=ts({store:t,id:n}));Qe(n)&&t.in.exec("select-task",{id:n});}else t.in.exec("check-task",{id:e});}function Ss({store:t}){t.eachSelected((e=>{!t.getTask(t.getTask(e).parent)?.selected&&function(t,e){const{treeTasks:n,filter:s,taskShape:o}=t.getState(),i=o?.completed?.taskHide,r=Qe(s?.match),a=t.getNearId({id:e,dir:"next",flat:!0,filtered:r,hideCompleted:i}),c=t.getTask(a),l=t.getTask(e);if(Ze(n.at(-1).id,e)||!Ze(c?.parent,l?.parent))return;t.in.exec("move-task",{id:e,parent:l?.parent,targetId:a});}(t,e);}),!0,!0);}function Ts({store:t}){t.eachSelected((e=>{!t.getTask(t.getTask(e).parent)?.selected&&function(t,e){const{treeTasks:n,filter:s,taskShape:o}=t.getState(),i=o?.completed?.taskHide,r=Qe(s?.match),a=t.getNearId({id:e,dir:"prev",flat:!0,filtered:r,hideCompleted:i}),c=t.getTask(a),l=t.getTask(e);if(Ze(n[0].id,e)||!Ze(c?.parent,l?.parent))return;t.in.exec("move-task",{id:e,targetId:a,parent:l?.parent,reverse:!0});}(t,e);}),!0);}function js(t,{code:e,event:n}){const{selected:s,stateEditableItem:o,filter:i,stateSearch:r,menu:a,stateDueDate:c,stateCombo:l}=t.getState(),d=Qe(o?.id);if(!Qe(s.at(-1))||r?.focus||l?.open||function(t,e,n){const{selected:s,stateEditableItem:o,readonly:i,filter:r}=t.getState(),a=Qe(o?.id),c=s.at(-1),l=t.getTask(c);if(o?.dropdown)return;if(!i)switch(e){case"shift+arrowup":Is(t,"prev");break;case"shift+arrowdown":Is(t,"next");break;case"shift+tab":n.preventDefault(),cs({store:t});break;case"tab":n.preventDefault(),as({store:t});break;case"delete":case"backspace":a||ss({store:t});break;case"enter":n.preventDefault(),a?!o?.currentValue&&Qe(l.parent)?(t.in.exec("unindent-task",{id:o.id}),t.in.exec("open-inline-editor",{id:o.id,type:"task"})):t.in.exec("close-inline-editor",{id:o.id}):Qe(r?.match)||ns({store:t,task:l});break;case"ctrl+enter":!a&&t.in.exec("open-inline-editor",{id:c,type:"task"});break;case"ctrl+d":n.preventDefault(),is({store:t});break;case"ctrl+c":!window.getSelection().toString()?.length&&rs({store:t});break;case"ctrl+v":!a&&os({store:t,id:c});break;case"ctrl+arrowup":Ts({store:t});break;case"ctrl+arrowdown":Ss({store:t});break;case"alt+0":ls({store:t,priority:null});break;case"alt+1":ls({store:t,priority:1});break;case"alt+2":ls({store:t,priority:2});break;case"alt+3":ls({store:t,priority:3});}switch(e){case"arrowup":Cs(t,"up");break;case"arrowdown":Cs(t,"down");break;case"arrowleft":Cs(t,"left");break;case"arrowright":Cs(t,"right");break;case"space":a||(n.preventDefault(),l?.checked?function({store:t}){t.eachSelected((e=>{t.getTask(e)?.checked&&t.in.exec("uncheck-task",{id:e});}),!0);}({store:t}):function({store:t}){t.eachSelected((e=>{_s({store:t,id:e});}),!0);}({store:t}));}}(t,e,n),"escape"===e)a?t.in.exec("close-menu",{...a}):d?t.in.exec("close-inline-editor",{...o,save:!1}):c?.open||l?.open?(t.in.exec("set-state-due-date",{...c,open:!1}),t.in.exec("set-state-combo",{open:!1})):(i&&t.in.exec("set-filter",{match:null}),r?.open&&t.in.exec("set-state-search",{...r,value:null,open:!1,dropdown:{open:!1}}));}function Cs(t,e){const{selected:n,treeTasks:s,stateEditableItem:o,filter:i,taskShape:r}=t.getState(),a=n.at(-1);if(Qe(o?.id))return;if(!Qe(a))return void t.in.exec("select-task",{id:s.at(0)?.id});const c=r?.completed?.taskHide,l=t.getTask(a),d=Qe(i);let u;switch(e){case"up":u=t.getNearId({id:a,dir:"prev",filtered:d,hideCompleted:c});break;case"down":u=t.getNearId({id:a,filtered:d,hideCompleted:c});break;case"left":t.hasChildren(l.id,d,c)&&!l.collapsed?t.in.exec("collapse-task",{id:l.id}):u=l?.parent;break;case"right":t.hasChildren(l.id,d,c)&&l.collapsed&&t.in.exec("expand-task",{id:l.id});}Qe(u)&&t.in.exec("select-task",{id:u});}function Is(t,e="next"){const{selected:n,filter:s,taskShape:o}=t.getState(),i=o?.completed?.taskHide,r=Qe(s),a=n.at(-1),c=t.getNearId({id:a,dir:e,filtered:r,hideCompleted:i});if(Qe(c))if(n.length>1&&t.getTask(c)?.selected)t.in.exec("unselect-task",{id:a});else if(t.in.exec("select-task",{id:c,join:!0}),"next"===e){const e=t.getChildrenIds({id:c});for(const n of e)t.getTask(n)?.selected||t.in.exec("select-task",{id:n,join:!0});}}function Ms(t,e){const n="string"==typeof e?.match?e.match.trim():null;let s={match:n,by:"string"==typeof e?.by?e.by.trim():null,...e};e&&n?.length||(s=null),t.setState({filter:s});}function Ds(t,e){if(!e)return;const n={by:e.by||"text",dir:e.dir||"asc",...e},{tasks:s,activeProject:o}=t.getState(),{treeTasks:i}=t.getInnerState(s,o,n);t.setState({treeTasks:i});}function Ps(t,{value:e,open:n,dropdown:s,focus:o}){const i=t.getState().stateSearch;t.setState({stateSearch:{value:e,open:Qe(n)?n:i?.open,dropdown:Qe(s)?s:i?.dropdown,focus:Qe(o)?o:i?.focus}});}function Es(t,e){t.setState({stateDueDate:e});}function Ns(t,e){t.setState({stateCombo:e});}function As(t,{start:e,mode:n}){if(!t.existsTask(e))return;const s=[];t.getTask(e).selected||t.in.exec("select-task",{id:e}),t.eachSelected((e=>{s.push(e);const n=t.getChildrenIds({id:e});for(const e of n){t.getTask(e)?.selected||s.push(e);}}),!0);for(let e=0;e<s.length;e++)t.updateTask({id:s[e],task:{draggable:!0},skipStateCalc:e!==s.length-1});t.setState({draggableIds:s,dragInfo:{mode:n}});}function Ls(t,{target:e,dropPosition:n,mode:s}){if(t.existsTask(e)){const o=t.getTask(e),i="move"===s?"move-task":"copy-task";if(!o.draggable&&"move"===s||"copy"===s){const s="bottom"===n,r=t.getSelection({sorted:!0}),a=r.filter((e=>{const n=t.getTask(e);return !r.some((e=>Ze(t.getTask(e).id,n.parent)))}));t.eachSelected(((s,r)=>{!t.getTask(t.getTask(s).parent)?.selected&&t.in.exec(i,{id:s,parent:"in"===n?e:o.parent,targetId:e,reverse:"top"===n,skipProvider:!!r,batch:!r&&a.length>1?a:null});}),!0,s);}}const{draggableIds:o}=t.getState();for(let e=0;e<o.length;e++)t.updateTask({id:o[e],task:{draggable:!1},skipStateCalc:e!==o.length-1});t.setState({draggableIds:[],dragInfo:null});}function Fs(t,{start:e,target:n,dropPosition:s}){const o=t.getState().drag?.expand;o&&t.getTask(n)?.collapsed&&t.in.exec("expand-task",{id:n});const i=t.getState().dragInfo;t.setState({dragInfo:{...i,start:e,target:n,dropPosition:s}});}function Rs(t,e){return `${"function"==typeof e?e(t):t[e]}`}function Os(t,e){if(e.tree)for(const n of t)n.children?.length&&Os(n.children,e);t.sort(function({dir:t,by:e}){return (n,s)=>{const o=Rs(n,e),i=Rs(s,e);return "undefined"===o||"null"===o?1:"undefined"===i||"null"==i?-1:"desc"===t?i.localeCompare(o,void 0,{numeric:!0}):o.localeCompare(i,void 0,{numeric:!0})}}(e));}function zs(t,e){const n={};for(let t=0;t<e.length;t++){const s=e[t];n[s.id]={...s,color:s.color||cn[t%cn.length]};}t.setState({priorityMap:n});}!function(t){t[t.separator=0]="separator",t[t.datePart=1]="datePart";}(Yn||(Yn={}));class Hs extends class{constructor(t){this._writable=t,this._values={},this._state={};}setState(t){const e=this._state;for(const n in t)e[n]?e[n].set(t[n]):this._state[n]=this._wrapWritable(n,t[n]);}getState(){return this._values}getReactive(){return this._state}_wrapWritable(t,e){const n=this._writable(e);return n.subscribe((e=>{this._values[t]=e;})),n}}{constructor(t){super(t),rn(),this.in=new We,this.out=new We,this.in.setNext(this.out.exec),this._router=new Be(super.setState.bind(this),[],{});const e={"add-task":vn,"update-task":yn,"move-task":bn,"copy-task":wn,"paste-task":_n,"delete-task":Sn,"expand-task":Tn,"collapse-task":jn,"check-task":Cn,"uncheck-task":In,"indent-task":Mn,"unindent-task":Dn,"add-project":Ln,"update-project":Fn,"set-project":Rn,"delete-project":On,"show-completed-tasks":Pn,"hide-completed-tasks":En,"select-task":Nn,"unselect-task":An,"open-menu":Qn,"close-menu":Kn,"click-menu-item":ms,"assign-user":gs,"unassign-user":$s,"open-inline-editor":ks,"close-inline-editor":xs,"edit-item":vs,"keypress-on-todo":js,"set-filter":Ms,"set-sort":Ds,"set-state-search":Ps,"set-state-due-date":Es,"set-state-combo":Ns,"start-drag":As,"end-drag":Ls,drag:Fs};this.in.on("set-filter",(()=>{const{tasks:t,activeProject:e,filter:n}=this.getState(),{treeTasks:s,childrenMap:o,filteredChildrenMap:i,tags:r}=this.getInnerState(t,e);n?.match&&xn(this),this.setState({treeTasks:s,childrenMap:o,filteredChildrenMap:i,tags:r});})),this._setHandlers(e);}init(t){this._router.init({id:null,selected:[],projects:[],tasks:[],users:[],tags:[],readonly:!1,taskShape:ln,drag:dn,priorities:[],treeTasks:[],copiedTasksId:[],defaultTags:[],tasksMap:null,usersMap:null,childrenMap:null,priorityMap:null,filteredChildrenMap:null,stateEditableItem:null,stateSearch:null,stateDueDate:null,stateCombo:null,draggableIds:[],dragInfo:null,filter:null,menu:null,...t});const{tasks:e,users:n,projects:s,tags:o,priorities:i}=this.getState();this.parse({tasks:e,users:n,projects:s,activeProject:t?.activeProject,tags:o}),zs(this,i);}setState(t,e){this._router.setState(t,e);}getSelection({sorted:t=!1}={}){let e=this.getState().selected;if(t){const t=this.getState().tasks,n={};for(const s of e)n[t.findIndex((t=>Ze(t.id,s)))]=s;e=Object.values(n);}return e}eachSelected(t,e=!1,n=!1){const s=this.getSelection({sorted:e});if(n){let e=0;for(let n=s.length-1;n>=0;n--)t(s[n],e++);}else for(let e=0;e<s.length;e++)t(s[e],e);}serialize(){const{tasks:t,projects:e,users:n,tags:s,activeProject:o,priorities:i}=this.getState();for(const e of t)delete e.selected,delete e.draggable;return {tasks:[...t],projects:[...e],users:[...n],tags:[...s],priorities:[...i],activeProject:o}}parse(t){if(!function(t){return null!==t&&"object"==typeof t&&!(t instanceof Date)}(t))return;const e=this.getState();if(t.tasks&&(t.tasks=function(t,e){const n=new Date;return gn(t).map((t=>{const s=t.id??Ye().toString();return delete t.selected,delete t.draggable,t.checked&&!t.completion_date&&(t.completion_date=n),t.creation_date||(t.creation_date=n),e.some((t=>Ze(t,s)))&&(t.selected=!0),{...t,id:s}}))}(t.tasks,e.selected)),t.tags){const e=(t.tags||[]).map((t=>t.startsWith("#")?t:`#${t}`));this.setState({defaultTags:[...new Set(e)]});}const n=t.tasks||e.tasks||[],s=t.projects||e.projects||[],o=t.users||e.users||[],i=Array.isArray(t.priorities)?t.priorities:e.priorities;let r=e.activeProject;void 0!==t?.activeProject&&s.find((e=>Ze(e.id,t.activeProject)))||Ke(t.activeProject)?r=t.activeProject:s.find((t=>Ze(t.id,e.activeProject)))||(r=s[0]?.id||null);const{treeTasks:a,childrenMap:c,filteredChildrenMap:l,usersMap:d,tags:u}=this.getInnerState(n,r);this.setState({treeTasks:a,childrenMap:c,filteredChildrenMap:l,usersMap:d,tags:u,tasks:n,projects:s,users:o,activeProject:r,priorities:i}),t.priorities&&zs(this,i),this._setTasksMap(n);}existsTask(t){return t in this.getState().tasksMap}existsProject(t){return Qe(this.getState().projects.find((e=>Ze(e.id,t)))?.id)}updateTask({id:t,task:e,skipStateCalc:n=!1}){if(!this.existsTask(t))return;const s=this.getState(),o=s.tasksMap,i=s.tasks.map((n=>{if(Ze(t,n.id)){const t={...n,...e,id:n.id};return o[n.id]=t,t}return n}));if(n)return void this.setState({tasks:i,tasksMap:o});const{treeTasks:r,childrenMap:a,filteredChildrenMap:c,usersMap:l,tags:d}=this.getInnerState(i,s.activeProject);this.setState({tasks:i,treeTasks:r,childrenMap:a,filteredChildrenMap:c,usersMap:l,tags:d,tasksMap:o});}moveTask({id:t,project:e,parent:n,targetId:s,reverse:o,silent:i=!1}){if(!this.existsTask(t)||Ze(t,n)||Ze(t,s))return;const r=this.getState(),a=this.getTask(t),c=this.existsTask(n),l=this.existsTask(s);a.parent=n??null,Ke(e)||this.existsProject(e)?a.project=e:a.project=l?this.getTask(s).project:c?this.getTask(n).project:r?.activeProject,i?this.updateTask({id:t,task:a}):this.in.exec("update-task",{id:t,task:a,skipProvider:!0,skipStateCalc:!0});const d=this.getChildrenIds({id:t,tree:!0}),u=d.length;if(void 0!==e&&this.hasChildren(t))for(let t=0;t<u;t++){const e=this.getTask(d[t]);"project"in e&&(i?this.updateTask({id:e.id,task:{...this.getTask(e.id),project:a.project}}):this.in.exec("update-task",{id:e.id,task:{...this.getTask(e.id),project:a.project},skipProvider:!0,skipStateCalc:!0}));}const p=r.tasks,f=p.findIndex((e=>Ze(e.id,t))),h=p.splice(f,u+1);let m=o?0:r.tasks.length+1;if(c&&!Qe(s)){const e=this.getChildrenIds({id:n,tree:!0}),s=e.length&&!o?e.at(-1):n;m=Ze(t,s)?f:p.findIndex((t=>Ze(t.id,s)))+1;}if(l){const e=this.getChildrenIds({id:s,tree:!0});if(o)Ze(n,s)&&e.length&&!Ze(t,e[0])&&(s=e[0]),m=p.findIndex((t=>Ze(t.id,s)));else {for(let n=e.length-1;n>=0;n--){const o=e[n];if(!Ze(o,t)&&!d.some((t=>Ze(t,o)))){s=o;break}}m=p.findIndex((t=>Ze(t.id,s)))+1;}}p.splice(m,0,...h);const{treeTasks:g,childrenMap:$,filteredChildrenMap:k,usersMap:x}=this.getInnerState(p,r.activeProject);this.setState({tasks:p,treeTasks:g,childrenMap:$,filteredChildrenMap:k,usersMap:x}),this._setTasksMap(p);}pasteTask({targetId:t,parent:e,project:n,reverse:s}){const{copiedTasksId:o}=this.getState(),i=(t,e)=>{const n=sn(this.getTask(t)),s=this.getChildren({id:t});if(n.id=Xe().toString(),n.parent=e,"selected"in n&&delete n.selected,"draggable"in n&&delete n.draggable,r.push(n),s.length)for(let t=0;t<s.length;t++)i(s[t].id,n.id);},r=[];for(const t of o)i(t,e);for(let o=0;o<r.length;o++){const i=r[o];0===o?this.in.exec("add-task",{task:i,id:i.id,parent:e,targetId:t,reverse:s,project:n,skipProvider:!0}):this.in.exec("add-task",{task:i,id:i.id,parent:i.parent,targetId:r[o-1]?.id,project:n,skipProvider:!0});}r.length&&this.in.exec("clone-task",{parent:e,targetId:t,project:n,reverse:s,batch:r});}getTask(t){return this.getState().tasksMap[t]}getProject(t){return this.getState().projects.find((e=>Ze(e.id,t)))}getChildren({id:t,tree:e=!1,filtered:n=!1,hideCompleted:s=!1}){if(!this.existsTask(t)&&Qe(t))return;let o=[];if(Qe(t)){const s=this.getState()[n?"filteredChildrenMap":"childrenMap"][t];if(o=[...o,...s],e)for(let t=0;t<s.length;t++){const e=s[t];e?.children?.length&&(o=[...o,...this.getChildren({id:e.id,tree:!0,filtered:n})]);}}else o=this.getState().treeTasks;return s?o.filter((t=>!t.checked)):o}getChildrenIds({id:t,tree:e=!0,filtered:n=!1,hideCompleted:s=!1}){if(!this.existsTask(t)&&Qe(t))return;let o=[];const i=this.getChildren({id:t,tree:!1,filtered:n,hideCompleted:s});for(let t=0;t<i.length;t++){const r=i[t];o.push(r.id),r?.children?.length&&e&&(o=[...o,...this.getChildrenIds({id:r.id,tree:e,filtered:n,hideCompleted:s})]);}return o}getParentIds(t){if(!this.existsTask(t))return;const e=[],n=this.getTask(t)?.parent;return this.existsTask(n)&&e.push(n,...this.getParentIds(n)),e}getTailId(t,e=!1,n=!1){const s=this.getChildrenIds({id:t,filtered:e,hideCompleted:n});return s.length?s.at(-1):t}hasChildren(t,e,n=!1){const s=this.getState()[e?"filteredChildrenMap":"childrenMap"];return !!(n?s[t]?.filter((t=>!t.checked)):s[t])?.length}getTreeIndex(t,e=!1,n=!1){const s=this.getTask(t);return this.getChildren({id:s?.parent,filtered:e,hideCompleted:n}).findIndex((e=>Ze(e.id,t)))}getNearId({id:t,dir:e="next",flat:n=!1,filtered:s=!1,hideCompleted:o=!1}){if(this.existsTask(t))return "next"===e?this._getNextId(t,n,!1,s,o):this._getPrevId(t,n,s,o)}getInnerState(t,e,n){const{users:s,filter:o,taskShape:i,defaultTags:r}=this.getState(),a=sn(t),c=new Set(r),l=function(t){const e={};t=sn(t);for(let n=0;n<t?.length;n++){const s=t[n];s.color=s.color||an[n%an.length],e[s.id]=s;}return e}(s),d={},u={};let p={},f=[];for(let t=0;t<a.length;t++){const e=a[t];if(e.assigned?.length&&s?.length&&(e.availableUsers=kn(l,e)),d[a[t].id]=t,a[t].children=[],u[e.id]=[],e.text){const t=e.text.matchAll(fn("#"));for(const e of t)c.add(e[0]);}}for(let t=0;t<a.length;t++){const e=a[t];e.parent&&u[e.parent]?(a[d[e.parent]].children.push(e),u[e.parent].push(e)):Qe(e.parent)||f.push(e);}if(f=f.filter((t=>Ze(t.project,e))),n){const e=f.at(0).id;Os(f,n);const s=on(f),o=t.findIndex((t=>Ze(t.id,e)));t.splice(o,s.length,...s),this.setState({tasks:t});}Qe(o)&&(f=mn(f,o),p=function(t){const e={},n=t=>{for(let s=0;s<t.length;s++){const o=t[s];e[o.id]||(e[o.id]=[...o?.children]),o?.children?.length&&n(o.children);}};return n(t),e}(f));for(let t=0;t<f.length;t++)$n(f[t],u,i);return {treeTasks:f,childrenMap:u,usersMap:l,filteredChildrenMap:p,tags:[...c]}}_setTasksMap(t){const e={};for(const n of t)e[n.id]=n;this.setState({tasksMap:e});}_setHandlers(t){Object.keys(t).forEach((e=>{this.in.on(e,(n=>t[e](this,n)));}));}_getNextId(t,e=!1,n=!1,s=!1,o=!1){const i=this.getTask(t),r=this.hasChildren(t,s,o);if(e||!r||i.collapsed||n){const n=this.getTask(i?.parent)?.id,r=this.getChildren({id:n,filtered:s,hideCompleted:o}),a=tn(r,(e=>Ze(e.id,t)));return a+1<r.length?r[a+1]?.id:Qe(n)?this._getNextId(n,e,!0,s,o):null}return this.getChildren({id:t,filtered:s,hideCompleted:o})[0]?.id}_getPrevId(t,e=!1,n=!1,s=!1){const o=this.getTreeIndex(t,n,s),i=this.getTask(t)?.parent;if(o>0){let t=this.getChildren({id:i,filtered:n,hideCompleted:s})[o-1];if(!this.hasChildren(t.id,n,s)||t.collapsed)return t.id;for(;!e&&this.hasChildren(t.id,n,s)&&!t.collapsed;){const e=this.getChildren({id:t.id,filtered:n,hideCompleted:s});t=e[e.length-1];}return t.id}return Qe(i)?i:null}}function qs(t,e){return t.filter((t=>t.includes(e))).map((t=>({label:t,id:t})))}const Ys=(t=[],e)=>t.map((t=>(t?.label&&(t.label=e(t.label)),t?.data&&Ys(t.data,e),t))),Bs=t=>{const e={},n=["monthShort","monthFull","dayShort","dayFull"];for(const s of n)e[s]=t(s);return e};function Js(t,e){let n;const s=e.api,o=e.readonly,i=t=>{n=t.target;},r=t=>{const e=bs(n,"data-list-id"),i=n===t.target,{stateEditableItem:r}=s.getState();if(!Ze(r?.id,e)&&i){const i=bs(n,"data-menu-id"),r=2===t.button,a=s.getSelection();let c=t.ctrlKey||t.metaKey,l=t.shiftKey;if(o&&(c=l=!1),r&&a.some((t=>Ze(t,e)))||i&&a.some((t=>Ze(t,i))))return;!function({id:t,api:e,ctrlMode:n,shiftMode:s}){const{selected:o,treeTasks:i,taskShape:r}=e.getState();if(!Qe(t))return void e.eachSelected((t=>{e.exec("unselect-task",{id:t});}));const a=e.getTask({id:t});if(n&&a?.selected){e.exec("unselect-task",{id:t});const n=e.getParentIds({id:t});for(const t of n){e.getTask({id:t})?.selected&&e.exec("unselect-task",{id:t});}return}if(a?.selected)return void(n||s||e.eachSelected((n=>{Ze(n,t)||e.exec("unselect-task",{id:n});})));e.exec("select-task",{id:t,join:n||s}),(n||s)&&Ws(e,t);if(!n&&s&&o.length>1){const n=r?.completed?.taskHide,s=n?on(i).filter((t=>!t.checked)):on(i),a=o[0],c=s.findIndex((t=>Ze(t.id,a))),l=s.findIndex((e=>Ze(e.id,t)));if(c<0||l<0)return;if(c<l)for(let t=c+1;t<l;t++){const n=s[t];n?.selected||(e.exec("select-task",{id:n.id,join:!0}),Ws(e,n.id));}else if(c>l)for(let t=c-1;t>l;t--){const n=s[t];n?.selected||(e.exec("select-task",{id:n.id,join:!0}),Ws(e,n.id));}}}({id:e,api:s,ctrlMode:c,shiftMode:l}),t.stopPropagation(),document.getSelection().removeAllRanges();}};return t.addEventListener("mousedown",i),t.addEventListener("mouseup",r),{destroy(){t.removeEventListener("mousedown",i),t.removeEventListener("mouseup",r);}}}function Ws(t,e){const n=t.getChildrenIds({id:e});for(const e of n){!t.getTask({id:e})?.selected&&t.exec("select-task",{id:e,join:!0});}}function Gs(t,e){if(e?.readonly)return;const n=e.api;let s,o,i,r=null,a=null,c=null,l=null,d=null,u=null,p=[],f=null,h=null,m=null,g={},$=null,k=!1,x=!1;const v={duration:500,timer:null,callback:null},y=t=>{if(o&&clearTimeout(o),a){const e=50,n=a.getBoundingClientRect(),s={x:a.scrollLeft,y:a.scrollTop},{x:i,y:r}=Vs(t);i>n.width+n.left-e&&a.scrollTo(s.x+e,s.y),i<n.left+e&&a.scrollTo(s.x-e,s.y),r>n.height+n.top-e&&a.scrollTo(s.x,s.y+e),r<n.top+e&&a.scrollTo(s.x,s.y-e),o=setTimeout((()=>{y(t);}),100);}},b=t=>{s=M(t),S(s),(t=>{const{x:e,y:s}=Vs(t),o=document.elementFromPoint(e,s);o&&o.dataset.separator||(d=o?ys(o,"data-drag-list-id"):null,h=d?bs(d,"data-drag-list-id"):null,"move"===$&&n.getTask({id:h})?.draggable&&(h=null));})(t),m=Qe(h)?function(t,e){if(!e)return null;const{top:n,height:s}=e.getBoundingClientRect(),o=(Vs(t).y-n)/s;return o<=.25?"top":o>=.75?"bottom":"in"}(t,d):null,h?w(m):_(),n.exec("drag",{start:f,source:p,target:h,dropPosition:m});},w=t=>{r.contains(u)||(u=document.createElement("div"),u.classList.add("wx-todo_dropped-line"),r.appendChild(u));const e=d.getBoundingClientRect();if("in"===t)return u.style.opacity="0.5",u.style.width=e.width+"px",u.style.height=e.height+"px",u.style.left=e.x+"px",void(u.style.top=e.y+"px");const s=getComputedStyle(d),o=n.hasChildren({id:h,filtered:k,hideCompleted:x}),i=o?16:40,a=parseInt(d.dataset.listLevel),c=1===a?"top"===t?-6.5:6.5:0,l="top"===t?0:parseFloat(s.height),p=parseFloat(s.paddingLeft)-(1===a?i:0),f=e.width-p;u.style.opacity="1",u.style.width=f+"px",u.style.height="4px";let m=0;if("bottom"===t&&o){const t=d.parentElement.getBoundingClientRect();m=1===a?t.height-l-c-4-4:t.height-l;}u.style.top=e.y+l+c+m-2+"px",u.style.left=e.x+p+"px";},_=()=>{r.contains(u)&&r.removeChild(u);},S=({x:t,y:e})=>{l.style.left=t+"px",l.style.top=e+"px";},T=t=>{const e=n.hasChildren({id:h,filtered:k,hideCompleted:x})?16:40;p.length>1&&r.style.setProperty("--wx-todo-dragged-tasks-count",JSON.stringify(p.length<99?`${p.length}`:"+99")),s=M(t),r.appendChild(l),l.classList.add("wx-todo__dragged-task"),l.style.paddingLeft=e+"px",l.style.left=s.x+"px",l.style.top=s.y+"px";},j=t=>{const{stateEditableItem:s,menu:o,stateDueDate:d}=n.getState(),u=t.ctrlKey||t.metaKey,p=t.shiftKey,h=Qe(s);if(!(u||p||h||d?.open||o||t.touches&&t.touches.length>1||"button"in t&&0!==t.button)){if(r=document.querySelector(".wx-todo"),a=document.querySelector(`[data-todo-wrapper-id="${e.id}"]`),c=ys(t.target,"data-drag-list-id"),f=bs(t.target,"data-drag-list-id"),i="touches"in t?{up:"touchend",move:"touchmove"}:{up:"pointerup",move:"mousemove"},c&&a){k=!!n.getState().filter?.match,x=n.getState().taskShape?.completed?.taskHide;const e=c.getBoundingClientRect(),s=getComputedStyle(c),o=n.hasChildren({id:f,filtered:k,hideCompleted:x})?16:40,r=parseInt(s.paddingLeft)-o;l=c.cloneNode(!0),l.style.width=e.width-r+"px",l.style.height=e.height+"px";const{x:a,y:d}=g=Vs(t);g.shiftX=a-e.x-r,g.shiftY=d-e.y,"touches"in t?(v.callback=()=>{document.addEventListener(i.move,C);},v.timer=setTimeout(v.callback,v.duration)):document.addEventListener(i.move,C);}document.addEventListener(i.up,I);}},C=t=>{g&&("touches"in t||t.preventDefault(),t.stopPropagation(),y(t),p?.length?b(t):(t=>{const{x:e,y:s}=Vs(t);g?.x===e&&g?.y===s||Qe(f)&&($=t.altKey?"copy":"move",n.exec("start-drag",{start:f,mode:$}),p=n.getState().draggableIds,T(t),document.body.classList.add("wx-ondrag"),"touches"in t&&document.body.classList.add("wx-ondrag--touch"));})(t));},I=()=>{document.removeEventListener(i.move,C),document.removeEventListener(i.up,I),v.timer&&clearTimeout(v.timer),r.contains(l)&&(r.removeChild(l),r.style.removeProperty("--wx-todo-dragged-tasks-count")),_(),o&&clearTimeout(o),p.length&&(p=[],n.exec("end-drag",{target:h,dropPosition:m,mode:$})),document.body.classList.remove("wx-ondrag"),document.body.classList.remove("wx-ondrag--touch"),r=c=l=u=d=a=s=h=f=g=null;},M=t=>{const{x:e,y:n}=Vs(t);return {x:e-g.shiftX,y:n-g.shiftY}};return t.addEventListener("mousedown",j),t.addEventListener("touchstart",j),{destroy(){t.removeEventListener("mousedown",j),t.removeEventListener("touchstart",j);}}}function Vs(t){const e={x:0,y:0};return "touches"in t?(e.x=t.touches[0].clientX,e.y=t.touches[0].clientY):(e.x=t.clientX,e.y=t.clientY),e}function Us(t,e){if(e.readonly)return;const n=t=>{const n=t.target,s=2===t.button;if(n||s){!function({api:t,id:e,menuId:n,context:s}){const{menu:o}=t.getState(),i=t.getSelection({sorted:!0});o&&"task"===o.type&&t.exec("close-menu",{...o});(s||Qe(n))&&t.exec("open-menu",{id:e,type:"task",source:i});}({id:bs(n,"data-list-id"),menuId:bs(n,"data-menu-id"),api:e.api,context:s});}};return t.addEventListener("click",n),t.addEventListener("contextmenu",n),{destroy(){t.removeEventListener("click",n),t.removeEventListener("contextmenu",n);}}}function Xs(t,e){const n=t=>{const n=ys(t,"data-user-menu-id"),{menu:s,draggableIds:o}=e.api.getState();if(n&&!o.length){const o=bs(t,"data-user-menu-id");if(!s||s&&!Ze(s.id,o)){const t=n.getBoundingClientRect();s&&e.api.exec("close-menu",{...s}),e.api.exec("open-menu",{id:o,type:"user",coords:{x:t.left,y:t.bottom}});}t.stopPropagation();}else s&&"user"===s.type&&e.api.exec("close-menu",{...s});};return t.addEventListener("pointerover",n),{destroy(){t.removeEventListener("pointerover",n);}}}function Zs(t,e){const n=t=>{const n=bs(t.target,"data-tag");n&&(e.api.exec("set-filter",{match:n,highlight:!0,strict:!0}),e.api.exec("set-state-search",{value:n,open:!0,focus:!1,dropdown:{open:!1}}),t.stopPropagation());};return t.addEventListener("click",n),{destroy(){t.removeEventListener("click",n);}}}function Qs(t,e){if(e.readonly)return;const n=e.api,s=t=>{const e=bs(t.target,"data-list-editor-id"),s=bs(t.target,"data-date"),{stateEditableItem:o}=n.getState();s&&!Qe(o)&&n.exec("open-inline-editor",{id:e,type:"task",targetDate:s}),"task"!==o?.type||Ze(o?.id,e)||o?.dropdown||n.exec("close-inline-editor",{id:o.id,save:!0});},o=t=>{const e=bs(t.target,"data-list-editor-id"),{stateEditableItem:s}=n.getState();Ze(s?.id,e)||n.exec("open-inline-editor",{id:e,type:"task"});};return t.addEventListener("click",s),t.addEventListener("dblclick",o),{destroy(){t.removeEventListener("click",s),t.removeEventListener("dblclick",o);}}}function Ks(t,e){let n;const s=t=>{n=bs(t,"data-todo-id");},o=t=>{Ze(e.widgetId,n)&&e.api.exec("keypress-on-todo",{code:to(t),event:t});};return t.addEventListener("mousedown",s),t.addEventListener("focusin",s),t.addEventListener("keydown",o),{destroy(){t.removeEventListener("mousedown",s),t.removeEventListener("focusin",s),t.removeEventListener("keydown",o);}}}function to(t){const e=[];let n=t?.code.toLowerCase();const s=t?.key.toLowerCase(),o=n.startsWith("key"),i=n.startsWith("digit"),r=n.startsWith("numpad");return (t.ctrlKey||t.metaKey)&&e.push("ctrl"),t.shiftKey&&e.push("shift"),t.altKey&&e.push("alt"),o&&(n=n.replace("key","")),i&&(n=n.replace("digit","")),r&&(n=n.replace("numpad","")),["control","alt","shift"].includes(s)||e.push(n),e.join("+")}function eo(t,e){t.forEach((t=>{e(t),t.data&&t.data.length&&eo(t.data,e);}));}let no=1;function so(t){return eo(t,(t=>{t.id=t.id||no++;})),t}const oo={};function io(t){return oo[t]}function ro(t,e){oo[t]=e;}function ao(t){let e,n;return {c(){e=T("i"),P(e,"class",n="icon "+t[0].icon+" svelte-bbgn98");},m(t,n){w(t,e,n);},p(t,s){1&s&&n!==(n="icon "+t[0].icon+" svelte-bbgn98")&&P(e,"class",n);},d(t){t&&_(e);}}}function co(t){let e,n,s=t[0].text+"";return {c(){e=T("span"),n=j(s),P(e,"class","value svelte-bbgn98");},m(t,s){w(t,e,s),b(e,n);},p(t,e){1&e&&s!==(s=t[0].text+"")&&E(n,s);},i:o,o:o,d(t){t&&_(e);}}}function lo(t){let e,n,s;var o=io(t[0].type);function i(t){return {props:{item:t[0]}}}return o&&(e=new o(i(t))),{c(){e&&gt(e.$$.fragment),n=I();},m(t,o){e&&$t(e,t,o),w(t,n,o),s=!0;},p(t,s){const r={};if(1&s&&(r.item=t[0]),o!==(o=io(t[0].type))){if(e){at();const t=e;dt(t.$$.fragment,1,0,(()=>{kt(t,1);})),ct();}o?(e=new o(i(t)),gt(e.$$.fragment),lt(e.$$.fragment,1),$t(e,n.parentNode,n)):e=null;}else o&&e.$set(r);},i(t){s||(e&&lt(e.$$.fragment,t),s=!0);},o(t){e&&dt(e.$$.fragment,t),s=!1;},d(t){t&&_(n),e&&kt(e,t);}}}function uo(t){let e,n,s=t[0].subtext+"";return {c(){e=T("span"),n=j(s),P(e,"class","subtext svelte-bbgn98");},m(t,s){w(t,e,s),b(e,n);},p(t,e){1&e&&s!==(s=t[0].subtext+"")&&E(n,s);},d(t){t&&_(e);}}}function po(t){let e;return {c(){e=T("i"),P(e,"class","sub-icon wxi-angle-right svelte-bbgn98");},m(t,n){w(t,e,n);},d(t){t&&_(e);}}}function fo(t){let e,n,s,o,i,r,a,l,d,u,p,f=t[0].icon&&ao(t);const h=[lo,co],m=[];function g(t,e){return t[0].type?0:1}s=g(t),o=m[s]=h[s](t);let $=t[0].subtext&&uo(t),k=t[0].data&&po();return {c(){e=T("div"),f&&f.c(),n=C(),o.c(),i=C(),$&&$.c(),r=C(),k&&k.c(),P(e,"class",a="item "+(t[0].css||"")+" svelte-bbgn98"),P(e,"data-id",l=t[0].id);},m(o,a){w(o,e,a),f&&f.m(e,null),b(e,n),m[s].m(e,null),b(e,i),$&&$.m(e,null),b(e,r),k&&k.m(e,null),d=!0,u||(p=[M(e,"mouseenter",t[1]),M(e,"click",t[4])],u=!0);},p(t,[c]){t[0].icon?f?f.p(t,c):(f=ao(t),f.c(),f.m(e,n)):f&&(f.d(1),f=null);let u=s;s=g(t),s===u?m[s].p(t,c):(at(),dt(m[u],1,1,(()=>{m[u]=null;})),ct(),o=m[s],o?o.p(t,c):(o=m[s]=h[s](t),o.c()),lt(o,1),o.m(e,i)),t[0].subtext?$?$.p(t,c):($=uo(t),$.c(),$.m(e,r)):$&&($.d(1),$=null),t[0].data?k||(k=po(),k.c(),k.m(e,null)):k&&(k.d(1),k=null),(!d||1&c&&a!==(a="item "+(t[0].css||"")+" svelte-bbgn98"))&&P(e,"class",a),(!d||1&c&&l!==(l=t[0].id))&&P(e,"data-id",l);},i(t){d||(lt(o),d=!0);},o(t){dt(o),d=!1;},d(t){t&&_(e),f&&f.d(),m[s].d(),$&&$.d(),k&&k.d(),u=!1,c(p);}}}function ho(t,e,n){let{item:s}=e,{showSub:o=!1}=e,{activeItem:i=null}=e;return t.$$set=t=>{"item"in t&&n(0,s=t.item),"showSub"in t&&n(2,o=t.showSub),"activeItem"in t&&n(3,i=t.activeItem);},[s,function(){n(2,o=!!s.data&&s.id),n(3,i=this);},o,i,function(e){W.call(this,t,e);}]}class mo extends yt{constructor(t){super(),vt(this,t,ho,fo,d,{item:0,showSub:2,activeItem:3});}}function go(t,e,n){const s=t.slice();return s[27]=e[n],s}function $o(t){let e,n,s,o;function i(e){t[14](e);}function r(e){t[15](e);}let a={item:t[27]};return void 0!==t[5]&&(a.showSub=t[5]),void 0!==t[6]&&(a.activeItem=t[6]),e=new mo({props:a}),V.push((()=>mt(e,"showSub",i))),V.push((()=>mt(e,"activeItem",r))),e.$on("click",(function(...e){return t[16](t[27],...e)})),{c(){gt(e.$$.fragment);},m(t,n){$t(e,t,n),o=!0;},p(o,i){t=o;const r={};4&i&&(r.item=t[27]),!n&&32&i&&(n=!0,r.showSub=t[5],tt((()=>n=!1))),!s&&64&i&&(s=!0,r.activeItem=t[6],tt((()=>s=!1))),e.$set(r);},i(t){o||(lt(e.$$.fragment,t),o=!0);},o(t){dt(e.$$.fragment,t),o=!1;},d(t){kt(e,t);}}}function ko(t){let e;return {c(){e=T("div"),P(e,"class","separator svelte-mlcdop");},m(t,n){w(t,e,n);},p:o,i:o,o:o,d(t){t&&_(e);}}}function xo(t){let e,n;return e=new wo({props:{options:t[27].data,at:"right-overlap",parent:t[6]}}),e.$on("click",t[17]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};4&n&&(s.options=t[27].data),64&n&&(s.parent=t[6]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function vo(t,e){let n,s,o,i,r,a;const c=[ko,$o],l=[];function d(t,e){return "separator"===t[27].type?0:1}s=d(e),o=l[s]=c[s](e);let u=e[27].data&&e[5]===e[27].id&&xo(e);return {key:t,first:null,c(){n=I(),o.c(),i=C(),u&&u.c(),r=I(),this.first=n;},m(t,e){w(t,n,e),l[s].m(t,e),w(t,i,e),u&&u.m(t,e),w(t,r,e),a=!0;},p(t,n){let a=s;s=d(e=t),s===a?l[s].p(e,n):(at(),dt(l[a],1,1,(()=>{l[a]=null;})),ct(),o=l[s],o?o.p(e,n):(o=l[s]=c[s](e),o.c()),lt(o,1),o.m(i.parentNode,i)),e[27].data&&e[5]===e[27].id?u?(u.p(e,n),36&n&&lt(u,1)):(u=xo(e),u.c(),lt(u,1),u.m(r.parentNode,r)):u&&(at(),dt(u,1,1,(()=>{u=null;})),ct());},i(t){a||(lt(o),lt(u),a=!0);},o(t){dt(o),dt(u),a=!1;},d(t){t&&_(n),l[s].d(t),t&&_(i),u&&u.d(t),t&&_(r);}}}function yo(e){let n,s,o,i,r=[],a=new Map,l=e[2];const d=t=>t[27].id;for(let t=0;t<l.length;t+=1){let n=go(e,l,t),s=d(n);a.set(s,r[t]=vo(s,n));}return {c(){n=T("div");for(let t=0;t<r.length;t+=1)r[t].c();P(n,"data-wx-menu","true"),P(n,"class","menu svelte-mlcdop"),A(n,"top",e[1]+"px"),A(n,"left",e[0]+"px"),A(n,"width",e[4]);},m(a,c){w(a,n,c);for(let t=0;t<r.length;t+=1)r[t].m(n,null);e[18](n),s=!0,o||(i=[y(t.call(null,n,e[10])),M(n,"mouseleave",e[9])],o=!0);},p(t,[e]){364&e&&(l=t[2],at(),r=ht(r,e,d,1,t,l,a,n,ft,vo,null,go),ct()),(!s||2&e)&&A(n,"top",t[1]+"px"),(!s||1&e)&&A(n,"left",t[0]+"px"),(!s||16&e)&&A(n,"width",t[4]);},i(t){if(!s){for(let t=0;t<l.length;t+=1)lt(r[t]);s=!0;}},o(t){for(let t=0;t<r.length;t+=1)dt(r[t]);s=!1;},d(t){t&&_(n);for(let t=0;t<r.length;t+=1)r[t].d();e[18](null),o=!1,c(i);}}}function bo(t,e,n){const s=Y();let o,i,r,a,c,l,d,u,p,f,h,{options:m}=e,{left:g=0}=e,{top:$=0}=e,{at:k="bottom"}=e,{parent:x=null}=e,{mount:v}=e,{context:y=null}=e;function b(){if(!h)return;const t=function(t){for(;t;){t=t.parentNode;const e=getComputedStyle(t).position;if(t===document.body||"relative"===e||"absolute"===e)return t}return null}(h),e=u?document.body:t;if(!t)return;const s=t.getBoundingClientRect(),p=h.getBoundingClientRect(),f=e.getBoundingClientRect();if(x&&"point"!==k){i=x.getBoundingClientRect();let t=u?0:1;n(0,g=l?i.right+t:i.left-t),n(1,$=r?i.bottom+1:i.top),n(4,o=c?i.width+"px":"auto");}let m=a;d&&n(1,$=i.top-p.height);const v=$+p.height-f.bottom;v>0&&n(1,$-=v);g+p.width-f.right>0&&(l?m=!0:n(0,g=i.right-p.width)),m&&n(0,g=i.left-p.width),g<0&&n(0,g="left"!==k?0:i.right),n(0,g+=e.scrollLeft-s.left),n(1,$+=e.scrollTop-s.top);}v&&v(b),H(b);return t.$$set=t=>{"options"in t&&n(2,m=t.options),"left"in t&&n(0,g=t.left),"top"in t&&n(1,$=t.top),"at"in t&&n(11,k=t.at),"parent"in t&&n(12,x=t.parent),"mount"in t&&n(13,v=t.mount),"context"in t&&n(3,y=t.context);},t.$$.update=()=>{4&t.$$.dirty&&so(m),2048&t.$$.dirty&&(r=-1!==k.indexOf("bottom"),a=-1!==k.indexOf("left"),l=-1!==k.indexOf("right"),d=-1!==k.indexOf("top"),u=-1!==k.indexOf("overlap"),c=-1!==k.indexOf("fit")),4096&t.$$.dirty&&b();},[g,$,m,y,o,p,f,h,s,function(){n(5,p=!1);},function(){s("click",{action:null});},k,x,v,function(t){p=t,n(5,p);},function(t){f=t,n(6,f);},(t,e)=>{if(!t.data&&!e.defaultPrevented){const e={context:y,action:t};t.handler&&t.handler(e),s("click",e);}},function(e){W.call(this,t,e);},function(t){V[t?"unshift":"push"]((()=>{h=t,n(7,h);}));}]}class wo extends yt{constructor(t){super(),vt(this,t,bo,yo,d,{options:2,left:0,top:1,at:11,parent:12,mount:13,context:3});}}function _o(t){let e,n,s,i;return {c(){e=T("i"),P(e,"class",n="wx-todo_icon wxi wxi-"+t[0]+" "+(t[4]?t[4]:"wx-todo_icon--default")+" svelte-1dloatb"),A(e,"font-size",t[1]+"px"),A(e,"height",t[1]+"px"),A(e,"width",t[1]+"px"),L(e,"wx-todo_icon--clickable",t[2]),L(e,"wx-todo_icon--disabled",t[3]);},m(n,o){w(n,e,o),s||(i=M(e,"click",t[5]),s=!0);},p(t,[s]){17&s&&n!==(n="wx-todo_icon wxi wxi-"+t[0]+" "+(t[4]?t[4]:"wx-todo_icon--default")+" svelte-1dloatb")&&P(e,"class",n),2&s&&A(e,"font-size",t[1]+"px"),2&s&&A(e,"height",t[1]+"px"),2&s&&A(e,"width",t[1]+"px"),21&s&&L(e,"wx-todo_icon--clickable",t[2]),25&s&&L(e,"wx-todo_icon--disabled",t[3]);},i:o,o:o,d(t){t&&_(e),s=!1,i();}}}function So(t,e,n){let{name:s}=e,{size:o=20}=e,{clickable:i=!1}=e,{disabled:r=!1}=e,{css:a=""}=e;return t.$$set=t=>{"name"in t&&n(0,s=t.name),"size"in t&&n(1,o=t.size),"clickable"in t&&n(2,i=t.clickable),"disabled"in t&&n(3,r=t.disabled),"css"in t&&n(4,a=t.css);},[s,o,i,r,a,function(e){W.call(this,t,e);}]}class To extends yt{constructor(t){super(),vt(this,t,So,_o,d,{name:0,size:1,clickable:2,disabled:3,css:4});}}function jo(t){let e,n;return e=new To({props:{name:t[1]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};2&n&&(s.name=t[1]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Co(t){let e,n;return {c(){e=T("div"),n=j(t[2]),P(e,"class","wx-todo_item__hotkey svelte-18hs7sv");},m(t,s){w(t,e,s),b(e,n);},p(t,e){4&e&&E(n,t[2]);},d(t){t&&_(e);}}}function Io(t){let e,n,s;return n=new To({props:{name:"menu-right"}}),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_item__sub-icon svelte-18hs7sv");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function Mo(t){let e,n,s,o,i,r,a,c=t[1]&&jo(t),l=t[2]&&Co(t),d=t[0]?.length&&Io();return {c(){e=T("div"),c&&c.c(),n=C(),s=T("div"),o=j(t[3]),i=C(),l&&l.c(),r=C(),d&&d.c(),P(s,"class","wx-todo_item__label svelte-18hs7sv"),P(e,"class","wx-todo_item svelte-18hs7sv");},m(t,u){w(t,e,u),c&&c.m(e,null),b(e,n),b(e,s),b(s,o),b(e,i),l&&l.m(e,null),b(e,r),d&&d.m(e,null),a=!0;},p(t,[s]){t[1]?c?(c.p(t,s),2&s&&lt(c,1)):(c=jo(t),c.c(),lt(c,1),c.m(e,n)):c&&(at(),dt(c,1,1,(()=>{c=null;})),ct()),(!a||8&s)&&E(o,t[3]),t[2]?l?l.p(t,s):(l=Co(t),l.c(),l.m(e,r)):l&&(l.d(1),l=null),t[0]?.length?d?1&s&&lt(d,1):(d=Io(),d.c(),lt(d,1),d.m(e,null)):d&&(at(),dt(d,1,1,(()=>{d=null;})),ct());},i(t){a||(lt(c),lt(d),a=!0);},o(t){dt(c),dt(d),a=!1;},d(t){t&&_(e),c&&c.d(),l&&l.d(),d&&d.d();}}}function Do(t,e,n){let s,o,i,r,{item:a}=e;return t.$$set=t=>{"item"in t&&n(4,a=t.item);},t.$$.update=()=>{16&t.$$.dirty&&n(3,s=a.label),16&t.$$.dirty&&n(2,o=a.hotkey),16&t.$$.dirty&&n(1,i=a.icon),16&t.$$.dirty&&n(0,r=a.data);},[r,i,o,s,a]}class Po extends yt{constructor(t){super(),vt(this,t,Do,Mo,d,{item:4});}}function Eo(t){let e,n,s;return {c(){e=T("div"),n=j(t[0]),P(e,"class","wx-todo_avatar svelte-2w6inz"),P(e,"style",s=t[3](t[2],t[1]));},m(t,s){w(t,e,s),b(e,n);},p(t,[o]){1&o&&E(n,t[0]),6&o&&s!==(s=t[3](t[2],t[1]))&&P(e,"style",s);},i:o,o:o,d(t){t&&_(e);}}}function No(t,e,n){let{value:s=""}=e,{avatar:o=""}=e,{color:i="#0AB169"}=e;return t.$$set=t=>{"value"in t&&n(0,s=t.value),"avatar"in t&&n(1,o=t.avatar),"color"in t&&n(2,i=t.color);},[s,o,i,(t,e)=>{let n=`background-color: ${t};`;return e&&(n+=`background-image: url(${e});`),n}]}class Ao extends yt{constructor(t){super(),vt(this,t,No,Eo,d,{value:0,avatar:1,color:2});}}function Lo(t){let e,n;return e=new To({props:{name:t[4]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};16&n&&(s.name=t[4]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Fo(t){let e,n,s,o,i,r,a,c,l=t[4]&&Lo(t);return o=new Ao({props:{avatar:t[2],color:t[3]}}),{c(){e=T("div"),l&&l.c(),n=C(),s=T("div"),gt(o.$$.fragment),i=C(),r=T("div"),a=j(t[5]),P(s,"class","wx-todo_user-item__avatar svelte-2s0u9f"),P(r,"class","wx-todo_user-item__label svelte-2s0u9f"),P(e,"class","wx-todo_user-item svelte-2s0u9f"),L(e,"wx-todo_user-item--checked",t[1]),L(e,"wx-todo_user-item--clicable",t[0]);},m(t,d){w(t,e,d),l&&l.m(e,null),b(e,n),b(e,s),$t(o,s,null),b(e,i),b(e,r),b(r,a),c=!0;},p(t,[s]){t[4]?l?(l.p(t,s),16&s&&lt(l,1)):(l=Lo(t),l.c(),lt(l,1),l.m(e,n)):l&&(at(),dt(l,1,1,(()=>{l=null;})),ct());const i={};4&s&&(i.avatar=t[2]),8&s&&(i.color=t[3]),o.$set(i),(!c||32&s)&&E(a,t[5]),2&s&&L(e,"wx-todo_user-item--checked",t[1]),1&s&&L(e,"wx-todo_user-item--clicable",t[0]);},i(t){c||(lt(l),lt(o.$$.fragment,t),c=!0);},o(t){dt(l),dt(o.$$.fragment,t),c=!1;},d(t){t&&_(e),l&&l.d(),kt(o);}}}function Ro(t,e,n){let s,o,i,r,a,c,{item:l}=e;return t.$$set=t=>{"item"in t&&n(6,l=t.item);},t.$$.update=()=>{64&t.$$.dirty&&n(5,s=l.label),64&t.$$.dirty&&n(4,o=l.icon),64&t.$$.dirty&&n(3,i=l.color),64&t.$$.dirty&&n(2,r=l.avatar),64&t.$$.dirty&&n(1,a=l.checked),64&t.$$.dirty&&n(0,c=l.clickable);},[c,a,r,i,o,s,l]}class Oo extends yt{constructor(t){super(),vt(this,t,Ro,Fo,d,{item:6});}}function zo(t){let e,n,s,o,i,r;function a(e){t[4](e);}let c={};return void 0!==t[0]&&(c.value=t[0]),n=new ge({props:c}),V.push((()=>mt(n,"value",a))),n.$on("change",t[2]),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_date-item svelte-1l2j6bx");},m(s,a){w(s,e,a),$t(n,e,null),o=!0,i||(r=M(e,"click",t[1]),i=!0);},p(t,[e]){const o={};!s&&1&e&&(s=!0,o.value=t[0],tt((()=>s=!1))),n.$set(o);},i(t){o||(lt(n.$$.fragment,t),o=!0);},o(t){dt(n.$$.fragment,t),o=!1;},d(t){t&&_(e),kt(n),i=!1,r();}}}function Ho(t,e,n){let s,o;let{item:i}=e;return t.$$set=t=>{"item"in t&&n(3,i=t.item);},t.$$.update=()=>{8&t.$$.dirty&&(s=i.store),8&t.$$.dirty&&n(0,o=i.value);},[o,t=>t.preventDefault(),()=>{const{menu:t}=s.getState(),e=s.getSelection().map((t=>({...s.getTask(t),due_date:o||null})));s.eachSelected(((t,n)=>{const i=s.getTask(t);s.in.exec("update-task",{id:t,task:{...i,due_date:o||null},skipProvider:!!n,batch:n?[]:e.slice(1)});})),s.in.exec("close-menu",{...t});},i,function(t){o=t,n(0,o),n(3,i);}]}class qo extends yt{constructor(t){super(),vt(this,t,Ho,zo,d,{item:3});}}function Yo(t){let e,n;return e=new To({props:{name:t[1]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};2&n&&(s.name=t[1]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Bo(t){let e,n;return {c(){e=T("div"),n=j(t[0]),P(e,"class","wx-todo_item__hotkey svelte-rqtk31");},m(t,s){w(t,e,s),b(e,n);},p(t,e){1&e&&E(n,t[0]);},d(t){t&&_(e);}}}function Jo(t){let e,n,s,o,i,r,a,c,l=t[1]&&Yo(t),d=t[0]&&Bo(t);return {c(){e=T("div"),l&&l.c(),n=C(),s=T("div"),o=C(),i=T("div"),r=j(t[3]),a=C(),d&&d.c(),P(s,"class","wx-todo_item__priority-icon svelte-rqtk31"),A(s,"background-color",t[2]),P(i,"class","wx-todo_item__label svelte-rqtk31"),P(e,"class","wx-todo_item svelte-rqtk31");},m(t,u){w(t,e,u),l&&l.m(e,null),b(e,n),b(e,s),b(e,o),b(e,i),b(i,r),b(e,a),d&&d.m(e,null),c=!0;},p(t,[o]){t[1]?l?(l.p(t,o),2&o&&lt(l,1)):(l=Yo(t),l.c(),lt(l,1),l.m(e,n)):l&&(at(),dt(l,1,1,(()=>{l=null;})),ct()),(!c||4&o)&&A(s,"background-color",t[2]),(!c||8&o)&&E(r,t[3]),t[0]?d?d.p(t,o):(d=Bo(t),d.c(),d.m(e,null)):d&&(d.d(1),d=null);},i(t){c||(lt(l),c=!0);},o(t){dt(l),c=!1;},d(t){t&&_(e),l&&l.d(),d&&d.d();}}}function Wo(t,e,n){let s,o,i,r,{item:a}=e;return t.$$set=t=>{"item"in t&&n(4,a=t.item);},t.$$.update=()=>{16&t.$$.dirty&&n(3,s=a.label),16&t.$$.dirty&&n(2,o=a.color),16&t.$$.dirty&&n(1,i=a.icon),16&t.$$.dirty&&n(0,r=a.hotkey);},[r,i,o,s,a]}class Go extends yt{constructor(t){super(),vt(this,t,Wo,Jo,d,{item:4});}}function Vo(t){let e,n,s;return n=new wo({props:{options:t[0],parent:t[1],mount:t[4],at:t[2]}}),n.$on("click",t[3]),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_menu");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},p(t,e){const s={};1&e&&(s.options=t[0]),2&e&&(s.parent=t[1]),16&e&&(s.mount=t[4]),4&e&&(s.at=t[2]),n.$set(s);},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function Uo(t){let e,n;return e=new Se({props:{theme:"material",$$slots:{default:[Vo,({mount:t})=>({4:t}),({mount:t})=>t?16:0]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,[n]){const s={};55&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Xo(t,e,n){ro("item",Po),ro("user",Oo),ro("datepicker",qo),ro("priority",Go);let{options:s}=e,{parent:o}=e,{at:i="bottom-left"}=e;return t.$$set=t=>{"options"in t&&n(0,s=t.options),"parent"in t&&n(1,o=t.parent),"at"in t&&n(2,i=t.at);},[s,o,i,function(e){W.call(this,t,e);}]}class Zo extends yt{constructor(t){super(),vt(this,t,Xo,Uo,d,{options:0,parent:1,at:2});}}function Qo(t){let e,n;return e=new To({props:{name:"check",size:16}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ko(t){let e,n,s,o,i,r,a,l=t[0]&&Qo();return {c(){e=T("label"),n=T("input"),s=C(),o=T("span"),l&&l.c(),P(n,"id",t[2]),n.disabled=t[1],P(n,"type","checkbox"),P(n,"class","wx-todo_checkbox__input svelte-1u2bz8m"),P(o,"class","wx-todo_checkbox__icon svelte-1u2bz8m"),L(o,"wx-todo_checkbox--checked",t[0]),P(e,"for",t[2]),P(e,"class","wx-todo_checkbox wx-todo_checkbox__label svelte-1u2bz8m"),L(e,"wx-todo_checkbox--disabled",t[1]);},m(c,d){w(c,e,d),b(e,n),n.checked=t[0],b(e,s),b(e,o),l&&l.m(o,null),i=!0,r||(a=[M(n,"change",D(t[3])),M(n,"change",t[4])],r=!0);},p(t,[s]){(!i||4&s)&&P(n,"id",t[2]),(!i||2&s)&&(n.disabled=t[1]),1&s&&(n.checked=t[0]),t[0]?l?1&s&&lt(l,1):(l=Qo(),l.c(),lt(l,1),l.m(o,null)):l&&(at(),dt(l,1,1,(()=>{l=null;})),ct()),1&s&&L(o,"wx-todo_checkbox--checked",t[0]),(!i||4&s)&&P(e,"for",t[2]),2&s&&L(e,"wx-todo_checkbox--disabled",t[1]);},i(t){i||(lt(l),i=!0);},o(t){dt(l),i=!1;},d(t){t&&_(e),l&&l.d(),r=!1,c(a);}}}function ti(t,e,n){let{disabled:s=!1}=e,{checked:o=!1}=e,{id:i=Xe().toString()}=e;return t.$$set=t=>{"disabled"in t&&n(1,s=t.disabled),"checked"in t&&n(0,o=t.checked),"id"in t&&n(2,i=t.id);},[o,s,i,function(e){W.call(this,t,e);},function(){o=this.checked,n(0,o);}]}class ei extends yt{constructor(t){super(),vt(this,t,ti,Ko,d,{disabled:1,checked:0,id:2});}}function ni(t){let e,n,s,o;const i=t[4].default,r=f(i,t,t[3],null);return {c(){e=T("button"),r&&r.c(),P(e,"class","wx-todo_button svelte-10n97i3"),A(e,"width","number"==typeof t[0]?`${t[0]}px`:t[0]),A(e,"height","number"==typeof t[1]?`${t[1]}px`:t[1]),L(e,"wx-todo_button--circle",t[2]);},m(i,a){w(i,e,a),r&&r.m(e,null),n=!0,s||(o=M(e,"click",t[5]),s=!0);},p(t,[s]){r&&r.p&&(!n||8&s)&&g(r,i,t,t[3],n?m(i,t[3],s,null):$(t[3]),null),(!n||1&s)&&A(e,"width","number"==typeof t[0]?`${t[0]}px`:t[0]),(!n||2&s)&&A(e,"height","number"==typeof t[1]?`${t[1]}px`:t[1]),4&s&&L(e,"wx-todo_button--circle",t[2]);},i(t){n||(lt(r,t),n=!0);},o(t){dt(r,t),n=!1;},d(t){t&&_(e),r&&r.d(t),s=!1,o();}}}function si(t,e,n){let{$$slots:s={},$$scope:o}=e,{width:i=20}=e,{height:r=20}=e,{circle:a=!1}=e;return t.$$set=t=>{"width"in t&&n(0,i=t.width),"height"in t&&n(1,r=t.height),"circle"in t&&n(2,a=t.circle),"$$scope"in t&&n(3,o=t.$$scope);},[i,r,a,o,s,function(e){W.call(this,t,e);}]}class oi extends yt{constructor(t){super(),vt(this,t,si,ni,d,{width:0,height:1,circle:2});}}function ii(t){let e,n=ps(t[0],t[1])+"";return {c(){e=T("div"),P(e,"class","wx-todo_text svelte-1h03wzk"),P(e,"tabindex","0"),L(e,"wx-todo_text--completed",t[2]);},m(t,s){w(t,e,s),e.innerHTML=n;},p(t,[s]){3&s&&n!==(n=ps(t[0],t[1])+"")&&(e.innerHTML=n),4&s&&L(e,"wx-todo_text--completed",t[2]);},i:o,o:o,d(t){t&&_(e);}}}function ri(t,e,n){let{value:s=""}=e,{filter:o}=e,{completed:i=!1}=e;return t.$$set=t=>{"value"in t&&n(0,s=t.value),"filter"in t&&n(1,o=t.filter),"completed"in t&&n(2,i=t.completed);},[s,o,i]}class ai extends yt{constructor(t){super(),vt(this,t,ri,ii,d,{value:0,filter:1,completed:2});}}function ci(t){let e,n;const s=t[4].default,o=f(s,t,t[6],null);return {c(){e=T("div"),o&&o.c(),P(e,"class","wx-todo_popup svelte-1thl4la"),A(e,"left",t[0].x+"px"),A(e,"top",t[0].y+"px");},m(s,i){w(s,e,i),o&&o.m(e,null),t[5](e),n=!0;},p(t,i){o&&o.p&&(!n||64&i)&&g(o,s,t,t[6],n?m(s,t[6],i,null):$(t[6]),null),(!n||1&i)&&A(e,"left",t[0].x+"px"),(!n||1&i)&&A(e,"top",t[0].y+"px");},i(t){n||(lt(o,t),n=!0);},o(t){dt(o,t),n=!1;},d(n){n&&_(e),o&&o.d(n),t[5](null);}}}function li(t){let e,n,s,o;return e=new Se({props:{theme:"material",$$slots:{default:[ci]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(i,r){$t(e,i,r),n=!0,s||(o=M(window,"mousedown",t[2]),s=!0);},p(t,[n]){const s={};67&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t),s=!1,o();}}}function di(t,e,n){let{$$slots:s={},$$scope:o}=e,{coords:i={x:0,y:0}}=e,{wrapper:r=document.body}=e,a=null;const c=Y();return q((function(){if(!a)return;const t=r.getBoundingClientRect(),e=a.getBoundingClientRect(),s=e.bottom-t.bottom;s>0&&n(0,i.y-=s,i);const o=e.right-t.right;o>0&&n(0,i.x-=o,i);})),t.$$set=t=>{"coords"in t&&n(0,i=t.coords),"wrapper"in t&&n(3,r=t.wrapper),"$$scope"in t&&n(6,o=t.$$scope);},[i,a,function(t){a.contains(t.target)||c("cancel",{event:t});},r,s,function(t){V[t?"unshift":"push"]((()=>{a=t,n(1,a);}));},o]}class ui extends yt{constructor(t){super(),vt(this,t,di,li,d,{coords:0,wrapper:3});}}function pi(t){let e,n,s;function o(e){t[6](e);}let i={};return void 0!==t[0]&&(i.value=t[0]),e=new ge({props:i}),V.push((()=>mt(e,"value",o))),e.$on("change",t[2]),{c(){gt(e.$$.fragment);},m(t,n){$t(e,t,n),s=!0;},p(t,s){const o={};!n&&1&s&&(n=!0,o.value=t[0],tt((()=>n=!1))),e.$set(o);},i(t){s||(lt(e.$$.fragment,t),s=!0);},o(t){dt(e.$$.fragment,t),s=!1;},d(t){kt(e,t);}}}function fi(t){let e,n;return e=new ui({props:{coords:t[1],$$slots:{default:[pi]},$$scope:{ctx:t}}}),e.$on("cancel",t[2]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,[n]){const s={};2&n&&(s.coords=t[1]),513&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function hi(t,e,n){let{coords:s}=e,{cancel:o=null}=e,{value:i=null}=e,{convert:r=!0}=e,{dateFormat:a="%d %M %Y"}=e;const c=Y(),l=J("wx-i18n").getGroup("calendar");i="string"==typeof i?Wn(i,a,!0,Bs(l)):i||null;return t.$$set=t=>{"coords"in t&&n(1,s=t.coords),"cancel"in t&&n(3,o=t.cancel),"value"in t&&n(0,i=t.value),"convert"in t&&n(4,r=t.convert),"dateFormat"in t&&n(5,a=t.dateFormat);},[i,s,()=>{i?c("change",{value:r?Jn(i,a,Bs(l)):i}):o&&o();},o,r,a,function(t){i=t,n(0,i);}]}class mi extends yt{constructor(t){super(),vt(this,t,hi,fi,d,{coords:1,cancel:3,value:0,convert:4,dateFormat:5});}}function gi(t,e,n){const s=t.slice();return s[7]=e[n],s}const $i=t=>({item:1&t}),ki=t=>({item:t[7]});function xi(t,e){let n,s,o,i;const r=e[5].default,a=f(r,e,e[4],ki);return {key:t,first:null,c(){n=T("li"),a&&a.c(),s=C(),P(n,"class","wx-todo_list__item svelte-15dwoyv"),P(n,"data-list-id",o=e[7].id),L(n,"wx-todo_list__item--selected",Ze(e[7].id,e[1])),this.first=n;},m(t,e){w(t,n,e),a&&a.m(n,null),b(n,s),i=!0;},p(t,s){e=t,a&&a.p&&(!i||17&s)&&g(a,r,e,e[4],i?m(r,e[4],s,$i):$(e[4]),ki),(!i||1&s&&o!==(o=e[7].id))&&P(n,"data-list-id",o),3&s&&L(n,"wx-todo_list__item--selected",Ze(e[7].id,e[1]));},i(t){i||(lt(a,t),i=!0);},o(t){dt(a,t),i=!1;},d(t){t&&_(n),a&&a.d(t);}}}function vi(t){let e,n,s,o,i=[],r=new Map,a=t[0];const l=t=>t[7].id;for(let e=0;e<a.length;e+=1){let n=gi(t,a,e),s=l(n);r.set(s,i[e]=xi(s,n));}return {c(){e=T("ul");for(let t=0;t<i.length;t+=1)i[t].c();P(e,"class","wx-todo_list svelte-15dwoyv");},m(r,a){w(r,e,a);for(let t=0;t<i.length;t+=1)i[t].m(e,null);n=!0,s||(o=[M(window,"keydown",t[3]),M(e,"click",t[2])],s=!0);},p(t,[n]){19&n&&(a=t[0],at(),i=ht(i,n,l,1,t,a,r,e,ft,xi,null,gi),ct());},i(t){if(!n){for(let t=0;t<a.length;t+=1)lt(i[t]);n=!0;}},o(t){for(let t=0;t<i.length;t+=1)dt(i[t]);n=!1;},d(t){t&&_(e);for(let t=0;t<i.length;t+=1)i[t].d();s=!1,c(o);}}}function yi(t,e,n){let{$$slots:s={},$$scope:o}=e,{options:i=[]}=e,r=null;const a=Y();return t.$$set=t=>{"options"in t&&n(0,i=t.options),"$$scope"in t&&n(4,o=t.$$scope);},[i,r,t=>{n(1,r=bs(t,"data-list-id")),a("click",{id:r});},t=>{const e=i.findIndex((t=>Ze(t.id,r)));switch(t.code){case"ArrowUp":t.preventDefault(),n(1,r=Qe(r)?i[e-1]?.id:i.at(-1).id);break;case"ArrowDown":t.preventDefault(),n(1,r=Qe(r)?i[e+1]?.id:i[0].id);break;case"Enter":t.preventDefault(),a("click",{id:r});}},o,s]}class bi extends yt{constructor(t){super(),vt(this,t,yi,vi,d,{options:0});}}function wi(t){let e,n,s,o="menu"===t[5].type&&_i(t),i="datepicker"===t[5].type&&ji(t);return {c(){o&&o.c(),e=C(),i&&i.c(),n=I();},m(t,r){o&&o.m(t,r),w(t,e,r),i&&i.m(t,r),w(t,n,r),s=!0;},p(t,s){"menu"===t[5].type?o?(o.p(t,s),32&s&&lt(o,1)):(o=_i(t),o.c(),lt(o,1),o.m(e.parentNode,e)):o&&(at(),dt(o,1,1,(()=>{o=null;})),ct()),"datepicker"===t[5].type?i?(i.p(t,s),32&s&&lt(i,1)):(i=ji(t),i.c(),lt(i,1),i.m(n.parentNode,n)):i&&(at(),dt(i,1,1,(()=>{i=null;})),ct());},i(t){s||(lt(o),lt(i),s=!0);},o(t){dt(o),dt(i),s=!1;},d(t){o&&o.d(t),t&&_(e),i&&i.d(t),t&&_(n);}}}function _i(t){let e,n;return e=new ui({props:{coords:t[5].coords,$$slots:{default:[Ti]},$$scope:{ctx:t}}}),e.$on("cancel",t[6]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};32&n&&(s.coords=t[5].coords),2097184&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Si(t){let e,n;return e=new Po({props:{item:t[20]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1048576&n&&(s.item=t[20]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ti(t){let e,n;return e=new bi({props:{options:t[5].options,$$slots:{default:[Si,({item:t})=>({20:t}),({item:t})=>t?1048576:0]},$$scope:{ctx:t}}}),e.$on("click",t[10]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};32&n&&(s.options=t[5].options),3145728&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function ji(t){let e,n;return e=new mi({props:{dateFormat:t[2].date.format,coords:t[5].coords,cancel:t[7],value:t[3].targetDate}}),e.$on("change",t[11]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};4&n&&(s.dateFormat=t[2].date.format),32&n&&(s.coords=t[5].coords),8&n&&(s.value=t[3].targetDate),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ci(t){let e,n,s,o,i,r,a,l=t[5]&&wi(t);return {c(){e=T("div"),n=j(t[0]),s=C(),l&&l.c(),o=I(),P(e,"class","wx-todo_editor svelte-124gm4f"),P(e,"contenteditable","true"),P(e,"data-placeholder",t[1]),P(e,"tabindex","0");},m(c,d){w(c,e,d),b(e,n),t[13](e),w(c,s,d),l&&l.m(c,d),w(c,o,d),i=!0,r||(a=[M(e,"input",t[8]),M(e,"keyup",t[9])],r=!0);},p(t,[s]){(!i||1&s)&&E(n,t[0]),(!i||2&s)&&P(e,"data-placeholder",t[1]),t[5]?l?(l.p(t,s),32&s&&lt(l,1)):(l=wi(t),l.c(),lt(l,1),l.m(o.parentNode,o)):l&&(at(),dt(l,1,1,(()=>{l=null;})),ct());},i(t){i||(lt(l),i=!0);},o(t){dt(l),i=!1;},d(n){n&&_(e),t[13](null),n&&_(s),l&&l.d(n),n&&_(o),r=!1,c(a);}}}function Ii(t,e,n){let s,{value:o=""}=e,{placeholder:i=""}=e,{tags:r=[]}=e,{shape:a}=e,{editor:c}=e,l=null,d=null,u=null;const p=Y();function f(t){const{x:e,y:n}=function(){const t=window.getSelection().getRangeAt(0).getBoundingClientRect();return {x:t.x,y:t.y}}();p("editing",{value:d,dropdown:{type:t,coords:{x:e+window.scrollX,y:n+window.scrollY+20},options:"menu"===t?qs(r,""):[]},targetDate:c.targetDate});}function h(){p("editing",{dropdown:null,value:d});}function m(t,e,s){const o=t[u+1],i=t;if(e=s+e,o)if(en(o)){const n=new RegExp(String.raw`${s}\s`,"gm");t=t.replace(n,((t,n)=>n===u?`${e} `:t));}else if("!"===s){const n=new RegExp(/!\((.+?)\)/gm);t=t.replace(n,((t,n,s)=>s===u?e:t));}else t=t.replace(fn(s),((t,n)=>n===u?e:t));else t+=e.substring(1);d=t,n(4,l.innerHTML=us(t),l),ws(l,u+(i!==d?e.length:1)),h();}return H((function(){d=o,c.targetDate?(u=d.indexOf(c.targetDate)-2,ws(l,u),f("datepicker")):ws(l);})),t.$$set=t=>{"value"in t&&n(0,o=t.value),"placeholder"in t&&n(1,i=t.placeholder),"tags"in t&&n(12,r=t.tags),"shape"in t&&n(2,a=t.shape),"editor"in t&&n(3,c=t.editor);},t.$$.update=()=>{8&t.$$.dirty&&n(5,s=c?.dropdown);},[o,i,a,c,l,s,h,function(){m(d,"","!"),h();},function(){d=l?.textContent||"",p("editing",{value:d,dropdown:c.dropdown});},function(t){if("Enter"===t.code)return;const e="#",n="!",s=function(t){const e=window.getSelection(),n=document.createRange();return n.setStart(t,0),n.setEnd(e.anchorNode,e.anchorOffset),n.toString().length}(l)-1,o=d[s],i=d[s-1],a=!Qe(i)||en(i),m=(o===e||t.key===e)&&a,g=(o===n||t.key===n)&&a;if(m)f("menu"),u=s;else if(g)f("datepicker"),u=s;else if(c.dropdown){const t=[],n=new RegExp(/^\s*$/gm);for(let o=s;o>0;o--){const s=d[o];if(s===e){const e=t.reverse().join(""),n=qs(r,e);if(!n.length)break;return void p("editing",{dropdown:{...c.dropdown,options:n},value:d})}if(t.push(s),n.test(s))break}h();}},function(t){const e=t.detail.id;Qe(e)?m(d,e.substring(1),"#"):h();},function(t){const e=t.detail.value;m(d,`(${e})`,"!");},r,function(t){V[t?"unshift":"push"]((()=>{l=t,n(4,l);}));}]}class Mi extends yt{constructor(t){super(),vt(this,t,Ii,Ci,d,{value:0,placeholder:1,tags:12,shape:2,editor:3});}}function Di(t){let e,n,s,o,i,r,a,c,l;function d(t,e){return t[0]instanceof Date?Ei:Pi}n=new To({props:{name:"calendar",css:t[4],size:14}});let u=d(t),p=u(t),f=t[1]&&Ni(t);return {c(){e=T("div"),gt(n.$$.fragment),s=C(),o=T("span"),p.c(),r=C(),f&&f.c(),P(o,"class",i=v(t[4])+" svelte-1tdglu5"),P(e,"class","wx-todo_due-date svelte-1tdglu5"),L(e,"completed",t[3]);},m(i,d){w(i,e,d),$t(n,e,null),b(e,s),b(e,o),p.m(o,null),b(e,r),f&&f.m(e,null),t[15](e),a=!0,c||(l=M(e,"click",t[9]),c=!0);},p(t,s){const r={};16&s&&(r.css=t[4]),n.$set(r),u===(u=d(t))&&p?p.p(t,s):(p.d(1),p=u(t),p&&(p.c(),p.m(o,null))),(!a||16&s&&i!==(i=v(t[4])+" svelte-1tdglu5"))&&P(o,"class",i),t[1]?f?(f.p(t,s),2&s&&lt(f,1)):(f=Ni(t),f.c(),lt(f,1),f.m(e,null)):f&&(at(),dt(f,1,1,(()=>{f=null;})),ct()),8&s&&L(e,"completed",t[3]);},i(t){a||(lt(n.$$.fragment,t),lt(f),a=!0);},o(t){dt(n.$$.fragment,t),dt(f),a=!1;},d(s){s&&_(e),kt(n),p.d(),f&&f.d(),t[15](null),c=!1,l();}}}function Pi(t){let e,n=t[7]("Set due date")+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p:o,d(t){t&&_(e);}}}function Ei(t){let e,n=Jn(t[0],t[2],Bs(t[8]))+"";return {c(){e=j(n);},m(t,n){w(t,e,n);},p(t,s){5&s&&n!==(n=Jn(t[0],t[2],Bs(t[8]))+"")&&E(e,n);},d(t){t&&_(e);}}}function Ni(t){let e,n;return e=new Se({props:{$$slots:{default:[Li,({mount:t})=>({18:t}),({mount:t})=>t?262144:0]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};786497&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ai(t){let e,n,s;function o(e){t[14](e);}let i={};return void 0!==t[0]&&(i.value=t[0]),e=new ge({props:i}),V.push((()=>mt(e,"value",o))),e.$on("change",t[10]),{c(){gt(e.$$.fragment);},m(t,n){$t(e,t,n),s=!0;},p(t,s){const o={};!n&&1&s&&(n=!0,o.value=t[0],tt((()=>n=!1))),e.$set(o);},i(t){s||(lt(e.$$.fragment,t),s=!0);},o(t){dt(e.$$.fragment,t),s=!1;},d(t){kt(e,t);}}}function Li(t){let e,n;return e=new ve({props:{mount:t[18],area:t[6],$$slots:{default:[Ai]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};262144&n&&(s.mount=t[18]),64&n&&(s.area=t[6]),524289&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Fi(t){let e,n,s=t[0]&&Di(t);return {c(){s&&s.c(),e=I();},m(t,o){s&&s.m(t,o),w(t,e,o),n=!0;},p(t,[n]){t[0]?s?(s.p(t,n),1&n&&lt(s,1)):(s=Di(t),s.c(),lt(s,1),s.m(e.parentNode,e)):s&&(at(),dt(s,1,1,(()=>{s=null;})),ct());},i(t){n||(lt(s),n=!0);},o(t){dt(s),n=!1;},d(t){s&&s.d(t),t&&_(e);}}}function Ri(t,e,n){let{id:s}=e,{format:o="%d %M %Y"}=e,{value:i=null}=e,{validate:r=!0}=e,{completed:a=!1}=e,{open:c=!1}=e,{readonly:l=!1}=e;const d=J("wx-i18n").getGroup("todo"),u=J("wx-i18n").getGroup("calendar"),p=Y();let f="wx-todo_date",h=null,m=null;return t.$$set=t=>{"id"in t&&n(11,s=t.id),"format"in t&&n(2,o=t.format),"value"in t&&n(0,i=t.value),"validate"in t&&n(12,r=t.validate),"completed"in t&&n(3,a=t.completed),"open"in t&&n(1,c=t.open),"readonly"in t&&n(13,l=t.readonly);},t.$$.update=()=>{4101&t.$$.dirty&&i&&("string"==typeof i&&n(0,i=Wn(i,o,!1,Bs(u))),i?.getTime()||n(0,i=null),r&&i instanceof Date&&n(4,f=function(t){const e=new Date,n=new Date(e.getFullYear(),e.getMonth(),e.getDate()),s=new Date(t.getFullYear(),t.getMonth(),t.getDate());return n.getTime()<=s.getTime()}(i)?"wx-todo_date--current":"wx-todo_date--expired"));},[i,c,o,a,f,h,m,d,u,()=>{l||(n(6,m=h.getBoundingClientRect()),n(1,c=!0),p("action",{action:"set-state-due-date",data:{open:!0,id:s}}));},()=>{p("action",{action:"update-task",data:{id:s,task:{due_date:i||null}}}),n(1,c=!1),n(6,m=null),p("action",{action:"set-state-due-date",data:{open:!1,id:s}});},s,r,l,function(t){i=t,n(0,i),n(2,o),n(12,r);},function(t){V[t?"unshift":"push"]((()=>{h=t,n(5,h);}));}]}class Oi extends yt{constructor(t){super(),vt(this,t,Ri,Fi,d,{id:11,format:2,value:0,validate:12,completed:3,open:1,readonly:13});}}function zi(t){let e;return {c(){e=T("div"),P(e,"class","wx-todo_list__priority-label svelte-12quozm"),A(e,"background",t[0][t[1].priority]?.color);},m(t,n){w(t,e,n);},p(t,n){3&n&&A(e,"background",t[0][t[1].priority]?.color);},d(t){t&&_(e);}}}function Hi(t){let e;return {c(){e=T("div"),P(e,"class","wx-todo_list__priority-cover svelte-12quozm"),A(e,"background",t[0][t[1].priority]?.color);},m(t,n){w(t,e,n);},p(t,n){3&n&&A(e,"background",t[0][t[1].priority]?.color);},d(t){t&&_(e);}}}function qi(t){let e,n,s=t[2]?.label&&zi(t),i=t[2]?.cover&&Hi(t);return {c(){e=T("div"),s&&s.c(),n=C(),i&&i.c(),P(e,"class","wx-todo_list__priority svelte-12quozm");},m(t,o){w(t,e,o),s&&s.m(e,null),b(e,n),i&&i.m(e,null);},p(t,[o]){t[2]?.label?s?s.p(t,o):(s=zi(t),s.c(),s.m(e,n)):s&&(s.d(1),s=null),t[2]?.cover?i?i.p(t,o):(i=Hi(t),i.c(),i.m(e,null)):i&&(i.d(1),i=null);},i:o,o:o,d(t){t&&_(e),s&&s.d(),i&&i.d();}}}function Yi(t,e,n){let{priority:s}=e,{task:o}=e,{config:i}=e;return t.$$set=t=>{"priority"in t&&n(0,s=t.priority),"task"in t&&n(1,o=t.task),"config"in t&&n(2,i=t.config);},[s,o,i]}class Bi extends yt{constructor(t){super(),vt(this,t,Yi,qi,d,{priority:0,task:1,config:2});}}function Ji(t,e,n){const s=t.slice();return s[47]=e[n],s[49]=n,s}function Wi(t){let e,n,s;return n=new oi({props:{circle:!0,$$slots:{default:[Gi]},$$scope:{ctx:t}}}),n.$on("click",t[28]),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_list-toggle-button svelte-p6km7j");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},p(t,e){const s={};1&e[0]|524288&e[1]&&(s.$$scope={dirty:e,ctx:t}),n.$set(s);},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function Gi(t){let e,n;return e=new To({props:{name:t[0].collapsed?"menu-right":"menu-down"}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1&n[0]&&(s.name=t[0].collapsed?"menu-right":"menu-down"),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Vi(t){let e,n;return e=new Bi({props:{priority:t[12],task:t[0],config:t[15]?.priority}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};4096&n[0]&&(s.priority=t[12]),1&n[0]&&(s.task=t[0]),32768&n[0]&&(s.config=t[15]?.priority),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ui(t){let e,n;return e=new ai({props:{value:t[0].text||"",completed:t[0].checked,filter:t[17]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1&n[0]&&(s.value=t[0].text||""),1&n[0]&&(s.completed=t[0].checked),131072&n[0]&&(s.filter=t[17]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Xi(t){let e,n;return e=new Mi({props:{value:t[0].text||"",placeholder:t[18]("Type what you want"),shape:t[15],editor:t[3],tags:t[16]}}),e.$on("editing",t[29]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1&n[0]&&(s.value=t[0].text||""),32768&n[0]&&(s.shape=t[15]),8&n[0]&&(s.editor=t[3]),65536&n[0]&&(s.tags=t[16]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Zi(t){let e;function n(t,e){return "number"===t[0].counter.type?Ki:"percentage"===t[0].counter.type?Qi:void 0}let s=n(t),o=s&&s(t);return {c(){e=T("div"),o&&o.c(),P(e,"class","wx-todo_list__counter svelte-p6km7j");},m(t,n){w(t,e,n),o&&o.m(e,null);},p(t,i){s===(s=n(t))&&o?o.p(t,i):(o&&o.d(1),o=s&&s(t),o&&(o.c(),o.m(e,null)));},d(t){t&&_(e),o&&o.d();}}}function Qi(t){let e,n,s=Math.round(t[0].counter.done/t[0].counter.total*100)+"";return {c(){e=j(s),n=j("%");},m(t,s){w(t,e,s),w(t,n,s);},p(t,n){1&n[0]&&s!==(s=Math.round(t[0].counter.done/t[0].counter.total*100)+"")&&E(e,s);},d(t){t&&_(e),t&&_(n);}}}function Ki(t){let e,n,s,o=t[0].counter.done+"",i=t[0].counter.total+"";return {c(){e=j(o),n=j("/"),s=j(i);},m(t,o){w(t,e,o),w(t,n,o),w(t,s,o);},p(t,n){1&n[0]&&o!==(o=t[0].counter.done+"")&&E(e,o),1&n[0]&&i!==(i=t[0].counter.total+"")&&E(s,i);},d(t){t&&_(e),t&&_(n),t&&_(s);}}}function tr(t){let e,n,s,o,i=t[10],r=[];for(let e=0;e<i.length;e+=1)r[e]=nr(Ji(t,i,e));const a=t=>dt(r[t],1,1,(()=>{r[t]=null;}));let c=t[10].length>3&&sr(t);return {c(){e=T("div");for(let t=0;t<r.length;t+=1)r[t].c();n=C(),c&&c.c(),P(e,"class","wx-todo_user-menu svelte-p6km7j"),A(e,"width",(t[10].length>=3?60:16*t[10].length+14)+"px"),P(e,"data-user-menu-id",s=t[0].id);},m(s,i){w(s,e,i);for(let t=0;t<r.length;t+=1)r[t].m(e,null);b(e,n),c&&c.m(e,null),t[43](e),o=!0;},p(t,l){if(1024&l[0]){let s;for(i=t[10],s=0;s<i.length;s+=1){const o=Ji(t,i,s);r[s]?(r[s].p(o,l),lt(r[s],1)):(r[s]=nr(o),r[s].c(),lt(r[s],1),r[s].m(e,n));}for(at(),s=i.length;s<r.length;s+=1)a(s);ct();}t[10].length>3?c?(c.p(t,l),1024&l[0]&&lt(c,1)):(c=sr(t),c.c(),lt(c,1),c.m(e,null)):c&&(at(),dt(c,1,1,(()=>{c=null;})),ct()),(!o||1024&l[0])&&A(e,"width",(t[10].length>=3?60:16*t[10].length+14)+"px"),(!o||1&l[0]&&s!==(s=t[0].id))&&P(e,"data-user-menu-id",s);},i(t){if(!o){for(let t=0;t<i.length;t+=1)lt(r[t]);lt(c),o=!0;}},o(t){r=r.filter(Boolean);for(let t=0;t<r.length;t+=1)dt(r[t]);dt(c),o=!1;},d(n){n&&_(e),S(r,n),c&&c.d(),t[43](null);}}}function er(t){let e,n,s;return n=new Ao({props:{color:t[47].color,avatar:t[47].avatar}}),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_user-menu__avatar svelte-p6km7j"),A(e,"left",16*t[49]+"px");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},p(t,e){const s={};1024&e[0]&&(s.color=t[47].color),1024&e[0]&&(s.avatar=t[47].avatar),n.$set(s);},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function nr(t){let e,n,s=(3===t[10].length&&t[49]<3||t[49]<2)&&er(t);return {c(){s&&s.c(),e=I();},m(t,o){s&&s.m(t,o),w(t,e,o),n=!0;},p(t,n){3===t[10].length&&t[49]<3||t[49]<2?s?(s.p(t,n),1024&n[0]&&lt(s,1)):(s=er(t),s.c(),lt(s,1),s.m(e.parentNode,e)):s&&(at(),dt(s,1,1,(()=>{s=null;})),ct());},i(t){n||(lt(s),n=!0);},o(t){dt(s),n=!1;},d(t){s&&s.d(t),t&&_(e);}}}function sr(t){let e,n,s;return n=new Ao({props:{value:"+"+(t[10].length-2)}}),{c(){e=T("div"),gt(n.$$.fragment),P(e,"class","wx-todo_user-menu__avatar svelte-p6km7j"),A(e,"left","32px");},m(t,o){w(t,e,o),$t(n,e,null),s=!0;},p(t,e){const s={};1024&e[0]&&(s.value="+"+(t[10].length-2)),n.$set(s);},i(t){s||(lt(n.$$.fragment,t),s=!0);},o(t){dt(n.$$.fragment,t),s=!1;},d(t){t&&_(e),kt(n);}}}function or(t){let e,n,s,o;return n=new To({props:{name:"dots-v"}}),{c(){e=T("button"),gt(n.$$.fragment),P(e,"data-menu-id",s=t[0].id),P(e,"class","wx-todo_list-menu-button svelte-p6km7j");},m(s,i){w(s,e,i),$t(n,e,null),t[44](e),o=!0;},p(t,n){(!o||1&n[0]&&s!==(s=t[0].id))&&P(e,"data-menu-id",s);},i(t){o||(lt(n.$$.fragment,t),o=!0);},o(t){dt(n.$$.fragment,t),o=!1;},d(s){s&&_(e),kt(n),t[44](null);}}}function ir(t){let e,n,s,o="user"===t[2].type&&rr(t),i="task"===t[2].type&&ar(t);return {c(){o&&o.c(),e=C(),i&&i.c(),n=I();},m(t,r){o&&o.m(t,r),w(t,e,r),i&&i.m(t,r),w(t,n,r),s=!0;},p(t,s){"user"===t[2].type?o?(o.p(t,s),4&s[0]&&lt(o,1)):(o=rr(t),o.c(),lt(o,1),o.m(e.parentNode,e)):o&&(at(),dt(o,1,1,(()=>{o=null;})),ct()),"task"===t[2].type?i?(i.p(t,s),4&s[0]&&lt(i,1)):(i=ar(t),i.c(),lt(i,1),i.m(n.parentNode,n)):i&&(at(),dt(i,1,1,(()=>{i=null;})),ct());},i(t){s||(lt(o),lt(i),s=!0);},o(t){dt(o),dt(i),s=!1;},d(t){o&&o.d(t),t&&_(e),i&&i.d(t),t&&_(n);}}}function rr(t){let e,n;return e=new Zo({props:{options:t[10],parent:t[6]}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1024&n[0]&&(s.options=t[10]),64&n[0]&&(s.parent=t[6]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function ar(t){let e,n;return e=new Zo({props:{options:t[11],parent:t[7]}}),e.$on("click",t[30]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};2048&n[0]&&(s.options=t[11]),128&n[0]&&(s.parent=t[7]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function cr(t){let e,n,s,o,i,r,a,c,l,d,u,p,f,h,m,g,$,k,x,v,y,S,j=t[2]&&Ze(t[2].id,t[0].id),M=t[4]&&Wi(t);o=new ei({props:{checked:t[0].checked}}),o.$on("change",t[27]);let D=t[12][t[0].priority]&&Vi(t);const E=[Xi,Ui],N=[];function F(t,e){return t[8]&&!t[14]?0:1}l=F(t),d=N[l]=E[l](t),p=new Oi({props:{id:t[0].id,open:t[13]?.open&&Ze(t[0].id,t[13]?.id),format:t[15]?.date?.format,validate:t[15]?.date?.validate,completed:t[0].checked,value:t[0].due_date,readonly:t[14]}}),p.$on("action",t[42]);let R=t[4]&&Zi(t),O=t[10]?.length&&tr(t),z=!t[14]&&or(t),H=j&&ir(t);return {c(){e=T("div"),n=T("div"),M&&M.c(),s=C(),gt(o.$$.fragment),i=C(),r=T("div"),D&&D.c(),a=C(),c=T("div"),d.c(),u=C(),gt(p.$$.fragment),h=C(),m=T("div"),R&&R.c(),g=C(),O&&O.c(),$=C(),z&&z.c(),v=C(),H&&H.c(),y=I(),P(n,"class","wx-todo_list__controls wx-todo_list__controls-manual svelte-p6km7j"),P(c,"class","wx-todo_list__text svelte-p6km7j"),P(r,"class","wx-todo_list__content svelte-p6km7j"),P(r,"data-list-editor-id",f=t[0].id),P(m,"class","wx-todo_list__controls svelte-p6km7j"),P(e,"tabindex","0"),P(e,"data-list-level",t[1]),P(e,"data-list-id",k=t[0].id),P(e,"data-drag-list-id",x=t[0].id),P(e,"class","wx-todo_list svelte-p6km7j"),A(e,"padding-left",t[9]+"px"),L(e,"wx-todo_list--selected",t[0].selected&&!t[8]),L(e,"wx-todo_list--draggable",t[0].draggable&&!t[8]);},m(d,f){w(d,e,f),b(e,n),M&&M.m(n,null),b(n,s),$t(o,n,null),b(e,i),b(e,r),D&&D.m(r,null),b(r,a),b(r,c),N[l].m(c,null),b(r,u),$t(p,r,null),b(e,h),b(e,m),R&&R.m(m,null),b(m,g),O&&O.m(m,null),b(m,$),z&&z.m(m,null),t[45](e),w(d,v,f),H&&H.m(d,f),w(d,y,f),S=!0;},p(t,i){t[4]?M?(M.p(t,i),16&i[0]&&lt(M,1)):(M=Wi(t),M.c(),lt(M,1),M.m(n,s)):M&&(at(),dt(M,1,1,(()=>{M=null;})),ct());const u={};1&i[0]&&(u.checked=t[0].checked),o.$set(u),t[12][t[0].priority]?D?(D.p(t,i),4097&i[0]&&lt(D,1)):(D=Vi(t),D.c(),lt(D,1),D.m(r,a)):D&&(at(),dt(D,1,1,(()=>{D=null;})),ct());let h=l;l=F(t),l===h?N[l].p(t,i):(at(),dt(N[h],1,1,(()=>{N[h]=null;})),ct(),d=N[l],d?d.p(t,i):(d=N[l]=E[l](t),d.c()),lt(d,1),d.m(c,null));const v={};1&i[0]&&(v.id=t[0].id),8193&i[0]&&(v.open=t[13]?.open&&Ze(t[0].id,t[13]?.id)),32768&i[0]&&(v.format=t[15]?.date?.format),32768&i[0]&&(v.validate=t[15]?.date?.validate),1&i[0]&&(v.completed=t[0].checked),1&i[0]&&(v.value=t[0].due_date),16384&i[0]&&(v.readonly=t[14]),p.$set(v),(!S||1&i[0]&&f!==(f=t[0].id))&&P(r,"data-list-editor-id",f),t[4]?R?R.p(t,i):(R=Zi(t),R.c(),R.m(m,g)):R&&(R.d(1),R=null),t[10]?.length?O?(O.p(t,i),1024&i[0]&&lt(O,1)):(O=tr(t),O.c(),lt(O,1),O.m(m,$)):O&&(at(),dt(O,1,1,(()=>{O=null;})),ct()),t[14]?z&&(at(),dt(z,1,1,(()=>{z=null;})),ct()):z?(z.p(t,i),16384&i[0]&&lt(z,1)):(z=or(t),z.c(),lt(z,1),z.m(m,null)),(!S||2&i[0])&&P(e,"data-list-level",t[1]),(!S||1&i[0]&&k!==(k=t[0].id))&&P(e,"data-list-id",k),(!S||1&i[0]&&x!==(x=t[0].id))&&P(e,"data-drag-list-id",x),(!S||512&i[0])&&A(e,"padding-left",t[9]+"px"),257&i[0]&&L(e,"wx-todo_list--selected",t[0].selected&&!t[8]),257&i[0]&&L(e,"wx-todo_list--draggable",t[0].draggable&&!t[8]),5&i[0]&&(j=t[2]&&Ze(t[2].id,t[0].id)),j?H?(H.p(t,i),5&i[0]&&lt(H,1)):(H=ir(t),H.c(),lt(H,1),H.m(y.parentNode,y)):H&&(at(),dt(H,1,1,(()=>{H=null;})),ct());},i(t){S||(lt(M),lt(o.$$.fragment,t),lt(D),lt(d),lt(p.$$.fragment,t),lt(O),lt(z),lt(H),S=!0);},o(t){dt(M),dt(o.$$.fragment,t),dt(D),dt(d),dt(p.$$.fragment,t),dt(O),dt(z),dt(H),S=!1;},d(n){n&&_(e),M&&M.d(),kt(o),D&&D.d(),N[l].d(),kt(p),R&&R.d(),O&&O.d(),z&&z.d(),t[45](null),n&&_(v),H&&H.d(n),n&&_(y);}}}function lr(t,e,n){let s,o,i,r,a,c,l,d,u,f,h,m,g,$,k,x,v,y,b,w,_,S;const T=Y(),j=J("wx-i18n").getGroup("todo");let{store:C}=e,{api:I}=e,{task:M}=e,{level:D=0}=e,P=null,E=null,N=null;const{stateDueDate:A,stateEditableItem:L,menu:F,filter:R,tags:O,taskShape:z,readonly:q,priorityMap:B}=C;return p(t,A,(t=>n(35,x=t))),p(t,L,(t=>n(41,S=t))),p(t,F,(t=>n(40,_=t))),p(t,R,(t=>n(39,w=t))),p(t,O,(t=>n(38,b=t))),p(t,z,(t=>n(37,y=t))),p(t,q,(t=>n(36,v=t))),p(t,B,(t=>n(34,k=t))),M.selected&&H((()=>P?.focus())),t.$$set=t=>{"store"in t&&n(31,C=t.store),"api"in t&&n(32,I=t.api),"task"in t&&n(0,M=t.task),"level"in t&&n(1,D=t.level);},t.$$.update=()=>{1024&t.$$.dirty[1]&&n(3,s=S),512&t.$$.dirty[1]&&n(2,o=_),256&t.$$.dirty[1]&&n(17,i=w),128&t.$$.dirty[1]&&n(16,r=b),64&t.$$.dirty[1]&&n(15,a=y),32&t.$$.dirty[1]&&n(14,c=v),16&t.$$.dirty[1]&&n(13,l=x),8&t.$$.dirty[1]&&n(12,d=k),4&t.$$.dirty[0]&&n(11,u=Ys(o?.options||[],j)),1&t.$$.dirty[0]&&n(10,f=Ys(M?.availableUsers,j)),1&t.$$.dirty[0]&&n(4,h=M?.children?.length),16&t.$$.dirty[0]&&n(33,m=h?16:40),2&t.$$.dirty[0]|4&t.$$.dirty[1]&&n(9,g=m+(D>1?24*(D-1):0)),9&t.$$.dirty[0]&&n(8,$="task"===s?.type&&Ze(s?.id,M.id));},[M,D,o,s,h,P,E,N,$,g,f,u,d,l,c,a,r,i,j,A,L,F,R,O,z,q,B,function(){M?.checked?I.in.exec("uncheck-task",{id:M.id}):_s({store:I,id:M.id});},function(){T("action",{action:M.collapsed?"expand-task":"collapse-task",data:{id:M.id}});},function(t){const{value:e,dropdown:n,targetDate:s}=t.detail;T("action",{action:"edit-item",data:{id:M.id,currentValue:e,dropdown:n,targetDate:s}});},function(t){const e=t.detail.action?.id??t.detail.action;T("action",{action:"click-menu-item",data:{id:o.id,action:e,type:"task"}});},C,I,m,k,x,v,y,b,w,_,S,function(e){W.call(this,t,e);},function(t){V[t?"unshift":"push"]((()=>{E=t,n(6,E);}));},function(t){V[t?"unshift":"push"]((()=>{N=t,n(7,N);}));},function(t){V[t?"unshift":"push"]((()=>{P=t,n(5,P);}));}]}class dr extends yt{constructor(t){super(),vt(this,t,lr,cr,d,{store:31,api:32,task:0,level:1},null,[-1,-1]);}}function ur(t){let e,n;return {c(){e=T("div"),n=T("div"),P(n,"class","wx-todo_separator__line svelte-y9zbw4"),P(e,"class","wx-todo_separator svelte-y9zbw4"),A(e,"padding",t[0]),P(e,"data-separator",!0);},m(t,s){w(t,e,s),b(e,n);},p(t,[n]){1&n&&A(e,"padding",t[0]);},i:o,o:o,d(t){t&&_(e);}}}function pr(t,e,n){let{padding:s="6px 16px"}=e;return t.$$set=t=>{"padding"in t&&n(0,s=t.padding);},[s]}class fr extends yt{constructor(t){super(),vt(this,t,pr,ur,d,{padding:0});}}function hr(t,e,n){const s=t.slice();return s[12]=e[n],s}function mr(t){let e,n,s,o,i,r,a;n=new dr({props:{store:t[0],api:t[1],task:t[12],level:t[3]+1}}),n.$on("action",t[10]);const c=t[9].default,l=f(c,t,t[8],null);let d=t[12].children.length&&!t[12].collapsed&&gr(t),u=0===t[3]&&$r();return {c(){e=T("li"),gt(n.$$.fragment),s=C(),l&&l.c(),o=C(),d&&d.c(),i=C(),u&&u.c(),r=C(),P(e,"class","wx-todo_tree__row svelte-15zeydw");},m(t,c){w(t,e,c),$t(n,e,null),b(e,s),l&&l.m(e,null),b(e,o),d&&d.m(e,null),b(e,i),u&&u.m(e,null),b(e,r),a=!0;},p(t,s){const o={};1&s&&(o.store=t[0]),2&s&&(o.api=t[1]),4&s&&(o.task=t[12]),8&s&&(o.level=t[3]+1),n.$set(o),l&&l.p&&(!a||256&s)&&g(l,c,t,t[8],a?m(c,t[8],s,null):$(t[8]),null),t[12].children.length&&!t[12].collapsed?d?(d.p(t,s),4&s&&lt(d,1)):(d=gr(t),d.c(),lt(d,1),d.m(e,i)):d&&(at(),dt(d,1,1,(()=>{d=null;})),ct()),0===t[3]?u?8&s&&lt(u,1):(u=$r(),u.c(),lt(u,1),u.m(e,r)):u&&(at(),dt(u,1,1,(()=>{u=null;})),ct());},i(t){a||(lt(n.$$.fragment,t),lt(l,t),lt(d),lt(u),a=!0);},o(t){dt(n.$$.fragment,t),dt(l,t),dt(d),dt(u),a=!1;},d(t){t&&_(e),kt(n),l&&l.d(t),d&&d.d(),u&&u.d();}}}function gr(t){let e,n;return e=new yr({props:{store:t[0],api:t[1],level:t[3]+1,data:t[12].children}}),e.$on("action",t[11]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};1&n&&(s.store=t[0]),2&n&&(s.api=t[1]),8&n&&(s.level=t[3]+1),4&n&&(s.data=t[12].children),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function $r(t){let e,n;return e=new fr({}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function kr(t,e){let n,s,o,i=!(e[5]&&e[12].checked)&&mr(e);return {key:t,first:null,c(){n=I(),i&&i.c(),s=I(),this.first=n;},m(t,e){w(t,n,e),i&&i.m(t,e),w(t,s,e),o=!0;},p(t,n){(e=t)[5]&&e[12].checked?i&&(at(),dt(i,1,1,(()=>{i=null;})),ct()):i?(i.p(e,n),36&n&&lt(i,1)):(i=mr(e),i.c(),lt(i,1),i.m(s.parentNode,s));},i(t){o||(lt(i),o=!0);},o(t){dt(i),o=!1;},d(t){t&&_(n),i&&i.d(t),t&&_(s);}}}function xr(t){let e,n,s=[],o=new Map,i=t[2];const r=t=>t[12].id;for(let e=0;e<i.length;e+=1){let n=hr(t,i,e),a=r(n);o.set(a,s[e]=kr(a,n));}return {c(){e=T("ul");for(let t=0;t<s.length;t+=1)s[t].c();P(e,"class","wx-todo_tree svelte-15zeydw"),P(e,"data-todo-wrapper-id",t[4]),L(e,"wx-todo_tree--root",!t[3]);},m(t,o){w(t,e,o);for(let t=0;t<s.length;t+=1)s[t].m(e,null);n=!0;},p(t,[a]){303&a&&(i=t[2],at(),s=ht(s,a,r,1,t,i,o,e,ft,kr,null,hr),ct()),(!n||16&a)&&P(e,"data-todo-wrapper-id",t[4]),8&a&&L(e,"wx-todo_tree--root",!t[3]);},i(t){if(!n){for(let t=0;t<i.length;t+=1)lt(s[t]);n=!0;}},o(t){for(let t=0;t<s.length;t+=1)dt(s[t]);n=!1;},d(t){t&&_(e);for(let t=0;t<s.length;t+=1)s[t].d();}}}function vr(t,e,n){let s,o,{$$slots:i={},$$scope:r}=e,{store:a}=e,{api:c}=e,{data:l}=e,{level:d=0}=e,{id:u}=e;const f=a.taskShape;return p(t,f,(t=>n(7,o=t))),t.$$set=t=>{"store"in t&&n(0,a=t.store),"api"in t&&n(1,c=t.api),"data"in t&&n(2,l=t.data),"level"in t&&n(3,d=t.level),"id"in t&&n(4,u=t.id),"$$scope"in t&&n(8,r=t.$$scope);},t.$$.update=()=>{128&t.$$.dirty&&n(5,s=o?.completed?.taskHide);},[a,c,l,d,u,s,f,o,r,i,function(e){W.call(this,t,e);},function(e){W.call(this,t,e);}]}class yr extends yt{constructor(t){super(),vt(this,t,vr,xr,d,{store:0,api:1,data:2,level:3,id:4});}}function br(t){let e,n;return e=new yr({props:{data:t[2],id:t[3],store:t[0],api:t[1]}}),e.$on("action",t[6]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,[n]){const s={};4&n&&(s.data=t[2]),8&n&&(s.id=t[3]),1&n&&(s.store=t[0]),2&n&&(s.api=t[1]),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function wr(t,e,n){let s,o,{store:i}=e,{api:r}=e;const a=i.treeTasks;p(t,a,(t=>n(2,s=t)));const c=i.id;return p(t,c,(t=>n(3,o=t))),t.$$set=t=>{"store"in t&&n(0,i=t.store),"api"in t&&n(1,r=t.api);},[i,r,s,o,a,c,function(e){W.call(this,t,e);}]}class _r extends yt{constructor(t){super(),vt(this,t,wr,br,d,{store:0,api:1});}}function Sr(t){let e,n,s,i,r,a;return s=new To({props:{name:"plus",size:16}}),{c(){e=T("div"),n=T("div"),gt(s.$$.fragment),i=C(),r=T("span"),r.textContent=`${t[1]("Add task")}`,P(n,"class","wx-todo_button-add__icon svelte-1c08e70"),P(r,"class","wx-todo_button-add__text svelte-1c08e70"),P(e,"class","wx-todo_button-add__content svelte-1c08e70");},m(t,o){w(t,e,o),b(e,n),$t(s,n,null),b(e,i),b(e,r),a=!0;},p:o,i(t){a||(lt(s.$$.fragment,t),a=!0);},o(t){dt(s.$$.fragment,t),a=!1;},d(t){t&&_(e),kt(s);}}}function Tr(t){let e;return {c(){e=T("mark"),e.textContent=`${window.atob("VHJpYWw=")}`,P(e,"class","wx-todo_mark svelte-1c08e70"),L(e,"wx-todo_mark--error",process.env.TRIALDATE<new Date);},m(t,n){w(t,e,n);},p(t,n){0&n&&L(e,"wx-todo_mark--error",process.env.TRIALDATE<new Date);},d(t){t&&_(e);}}}function jr(t){let e,n,s,o,i,r,a=!t[0]();n=new oi({props:{height:36,width:"100%",$$slots:{default:[Sr]},$$scope:{ctx:t}}}),n.$on("click",t[2]),o=new fr({});let c=a&&Tr();return {c(){e=T("div"),gt(n.$$.fragment),s=C(),gt(o.$$.fragment),i=C(),c&&c.c(),P(e,"class","wx-todo_button-add svelte-1c08e70");},m(t,a){w(t,e,a),$t(n,e,null),b(e,s),$t(o,e,null),b(e,i),c&&c.m(e,null),r=!0;},p(t,[s]){const o={};8&s&&(o.$$scope={dirty:s,ctx:t}),n.$set(o),1&s&&(a=!t[0]()),a?c?c.p(t,s):(c=Tr(),c.c(),c.m(e,null)):c&&(c.d(1),c=null);},i(t){r||(lt(n.$$.fragment,t),lt(o.$$.fragment,t),r=!0);},o(t){dt(n.$$.fragment,t),dt(o.$$.fragment,t),r=!1;},d(t){t&&_(e),kt(n),kt(o),c&&c.d();}}}function Cr(t,e,n){let s;return s=()=>{if("undefined"==typeof window)return !0;const t=location.hostname,e=["ZGh0bWx4LmNvbQ==","ZGh0bWx4Y29kZS5jb20=","d2ViaXhjb2RlLmNvbQ==","d2ViaXguaW8=","cmVwbC5jbw==","Y3NiLmFwcA=="];for(let n=0;n<e.length;n++){const s=window.atob(e[n]);if(s===t||t.endsWith("."+s))return !0}return !1},[s,J("wx-i18n").getGroup("todo"),function(e){W.call(this,t,e);}]}class Ir extends yt{constructor(t){super(),vt(this,t,Cr,jr,d,{});}}const Mr=[];function Dr(t,e=o){let n;const s=new Set;function i(e){if(d(t,e)&&(t=e,n)){const e=!Mr.length;for(const e of s)e[1](),Mr.push(e,t);if(e){for(let t=0;t<Mr.length;t+=2)Mr[t][0](Mr[t+1]);Mr.length=0;}}}return {set:i,update:function(e){i(e(t));},subscribe:function(r,a=o){const c=[r,a];return s.add(c),1===s.size&&(n=e(i)||o),r(t),()=>{s.delete(c),0===s.size&&(n(),n=null);}}}}function Pr(t){let e,n;return e=new Ir({}),e.$on("click",t[7]),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p:o,i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Er(t){let e,n,s,o,i,r,a,d,u,p,f=!t[1]&&Pr(t);return o=new _r({props:{store:t[5],api:t[4]}}),o.$on("action",t[6]),{c(){e=T("div"),f&&f.c(),n=C(),s=T("div"),gt(o.$$.fragment),P(s,"class","wx-todo__wrapper svelte-1mc8pnb"),P(e,"class","wx-todo svelte-1mc8pnb"),P(e,"data-todo-id",t[0]);},m(c,l){w(c,e,l),f&&f.m(e,null),b(e,n),b(e,s),$t(o,s,null),d=!0,u||(p=[M(s,"contextmenu",Lr),y(Zs.call(null,s,{api:t[3]})),y(i=Js.call(null,s,{api:t[3],readonly:t[1]})),y(r=Us.call(null,s,{api:t[3],readonly:t[1]})),y(a=Gs.call(null,s,{api:t[3],readonly:!t[2]||t[1],id:t[0]})),y(Xs.call(null,s,{api:t[3]}))],u=!0);},p(t,s){t[1]?f&&(at(),dt(f,1,1,(()=>{f=null;})),ct()):f?(f.p(t,s),2&s&&lt(f,1)):(f=Pr(t),f.c(),lt(f,1),f.m(e,n)),i&&l(i.update)&&2&s&&i.update.call(null,{api:t[3],readonly:t[1]}),r&&l(r.update)&&2&s&&r.update.call(null,{api:t[3],readonly:t[1]}),a&&l(a.update)&&7&s&&a.update.call(null,{api:t[3],readonly:!t[2]||t[1],id:t[0]}),(!d||1&s)&&P(e,"data-todo-id",t[0]);},i(t){d||(lt(f),lt(o.$$.fragment,t),d=!0);},o(t){dt(f),dt(o.$$.fragment,t),d=!1;},d(t){t&&_(e),f&&f.d(),kt(o),u=!1,c(p);}}}function Nr(t){let e,n;return e=new Oe({props:{$$slots:{default:[Er]},$$scope:{ctx:t}}}),{c(){gt(e.$$.fragment);},m(t,s){$t(e,t,s),n=!0;},p(t,n){const s={};262151&n&&(s.$$scope={dirty:n,ctx:t}),e.$set(s);},i(t){n||(lt(e.$$.fragment,t),n=!0);},o(t){dt(e.$$.fragment,t),n=!1;},d(t){kt(e,t);}}}function Ar(t){let e,n,s,o,i,r;return s=new Ae({props:{words:{...He,...ze},optional:!0,$$slots:{default:[Nr]},$$scope:{ctx:t}}}),{c(){gt(s.$$.fragment);},m(a,c){$t(s,a,c),o=!0,i||(r=[y(e=Ks.call(null,window,{api:t[3],widgetId:t[0]})),y(n=Qs.call(null,window,{api:t[3],readonly:t[1]}))],i=!0);},p(t,[o]){e&&l(e.update)&&1&o&&e.update.call(null,{api:t[3],widgetId:t[0]}),n&&l(n.update)&&2&o&&n.update.call(null,{api:t[3],readonly:t[1]});const i={};262151&o&&(i.$$scope={dirty:o,ctx:t}),s.$set(i);},i(t){o||(lt(s.$$.fragment,t),o=!0);},o(t){dt(s.$$.fragment,t),o=!1;},d(t){kt(s,t),i=!1,c(r);}}}const Lr=t=>t.preventDefault();function Fr(t,e,n){let{id:s=Xe()}=e,{tasks:o=[]}=e,{projects:i=[]}=e,{users:r=[]}=e,{tags:a=[]}=e,{selected:c=[]}=e,{activeProject:l}=e,{readonly:d=!1}=e,{taskShape:u=ln}=e,{drag:p=dn}=e,{priorities:f}=e;const h=Y(),m=new Hs(Dr),g=m.getReactive();let $=new Ve(h);const k=function(t,e){let n=e;return {exec:t.in.exec,getState:t.getState.bind(t),getReactiveState:t.getReactive.bind(t),setNext:t=>{n.setNext(t.exec),n=t;},getStores:()=>({state:t}),intercept:t.in.on.bind(t.in),on:t.out.on.bind(t.out),getSelection:e=>t.getSelection(e),eachSelected:(e,n,s)=>t.eachSelected(e,n,s),serialize:()=>t.serialize(),parse:e=>t.parse(e),existsTask:({id:e})=>t.existsTask(e),existsProject:({id:e})=>t.existsProject(e),getTask:({id:e})=>t.getTask(e),getProject:({id:e})=>t.getProject(e),hasChildren:({id:e,filtered:n,hideCompleted:s})=>t.hasChildren(e,n,s),getChildrenIds:e=>t.getChildrenIds(e),getParentIds:({id:e})=>t.getParentIds(e)}}(m,$);return m.out.setNext($.exec),t.$$set=t=>{"id"in t&&n(0,s=t.id),"tasks"in t&&n(8,o=t.tasks),"projects"in t&&n(9,i=t.projects),"users"in t&&n(10,r=t.users),"tags"in t&&n(11,a=t.tags),"selected"in t&&n(12,c=t.selected),"activeProject"in t&&n(13,l=t.activeProject),"readonly"in t&&n(1,d=t.readonly),"taskShape"in t&&n(14,u=t.taskShape),"drag"in t&&n(2,p=t.drag),"priorities"in t&&n(15,f=t.priorities);},t.$$.update=()=>{65287&t.$$.dirty&&m.init({tasks:o,users:r,tags:a,selected:c,taskShape:{...ln,...u},drag:p?{...dn,...p}:p,priorities:Array.isArray(f)&&f||un,projects:i,activeProject:l,readonly:d,id:s});},[s,d,p,k,m,g,function(t){const{action:e,data:n}=t.detail;m.in.exec(e,n);},function(t){Qe(m.getState().filter)||(t.stopPropagation(),ns({store:m,reverse:!0}));},o,i,r,a,c,l,u,f]}class Rr extends yt{constructor(t){super(),vt(this,t,Fr,Ar,d,{id:0,tasks:8,projects:9,users:10,tags:11,selected:12,activeProject:13,readonly:1,taskShape:14,drag:2,priorities:15,api:3});}get api(){return this.$$.ctx[3]}}class ga{constructor(t){this._api=t;}on(t,e){this._api.on(t,e);}exec(t,e){this._api.exec(t,e);}}class $a{constructor(t,e){this.container="string"==typeof t?document.querySelector(t):t,this.config=e,this._init();}destructor(){this._widget.$destroy(),this._widget=this.api=this.events=null;}setConfig(t){t&&(this.config=Object.assign(Object.assign({},this.config),t),this._init());}parse(t){this.api.parse(t);}serialize(){return this.api.serialize()}existsTask(t){return this.api.existsTask(t)}existsProject(t){return this.api.existsProject(t)}getTask(t){return this.api.getTask(t)}getProject(t){return this.api.getProject(t)}hasChildren(t){return this.api.hasChildren(t)}getChildrenIds(t){return this.api.getChildrenIds(t)}getParentIds(t){return this.api.getParentIds(t)}setLocale(t){t&&this.setConfig({locale:t});}setFilter(t){this.api.exec("set-filter",t);}setSort(t){this.api.exec("set-sort",t);}selectTask(t){this.api.exec("select-task",t);}unselectTask(t){this.api.exec("unselect-task",t);}getSelection(t){return this.api.getSelection(t)}eachSelected(t,e,n){this.api.eachSelected(t,e,n);}addTask(t){this.api.exec("add-task",t);}copyTask(t){this.api.exec("copy-task",t);}pasteTask(t){this.api.exec("paste-task",t);}moveTask(t){this.api.exec("move-task",t);}updateTask(t){this.api.exec("update-task",t);}deleteTask(t){this.api.exec("delete-task",t);}indentTask(t){this.api.exec("indent-task",t);}unindentTask(t){this.api.exec("unindent-task",t);}checkTask(t){var e;(null===(e=this.getTask({id:t.id}))||void 0===e?void 0:e.checked)||this.api.exec("check-task",t);}uncheckTask(t){var e;(null===(e=this.getTask({id:t.id}))||void 0===e?void 0:e.checked)&&this.api.exec("uncheck-task",t);}expandTask(t){var e;(null===(e=this.getTask({id:t.id}))||void 0===e?void 0:e.collapsed)&&this.api.exec("expand-task",t);}collapseTask(t){var e;(null===(e=this.getTask({id:t.id}))||void 0===e?void 0:e.collapsed)||this.api.exec("collapse-task",t);}showCompletedTasks(){this.api.exec("show-completed-tasks",{});}hideCompletedTasks(){this.api.exec("hide-completed-tasks",{});}openInlineEditor(t){this.api.exec("open-inline-editor",t);}closeInlineEditor(t){this.api.exec("close-inline-editor",t);}assignUser(t){this.api.exec("assign-user",t);}unassignUser(t){this.api.exec("unassign-user",t);}addProject(t){this.api.exec("add-project",t);}updateProject(t){this.api.exec("update-project",t);}setProject(t){this.api.exec("set-project",t);}deleteProject(t){this.api.exec("delete-project",t);}_init(){var t;this._widget&&this.destructor();const e=new Map([["wx-i18n",s(null===(t=this.config)||void 0===t?void 0:t.locale)]]);this._widget=new Rr({target:this.container,props:Object.assign({},this.config),context:e}),this.api=this._widget.api,this.events=new ga(this.api);}}

    /* src/ToDo.svelte generated by Svelte v3.59.2 */
    const file = "src/ToDo.svelte";

    function create_fragment$1(ctx) {
    	let div;

    	const block = {
    		c: function create() {
    			div = element("div");
    			set_style(div, "width", "100%");
    			set_style(div, "height", "100%");
    			add_location(div, file, 18, 0, 357);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			/*div_binding*/ ctx[4](div);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			/*div_binding*/ ctx[4](null);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('ToDo', slots, []);
    	let { users } = $$props;
    	let { tasks } = $$props;
    	let { projects } = $$props;
    	let container;

    	onMount(() => {
    		new $a(container, { users, tasks, projects });
    	});

    	$$self.$$.on_mount.push(function () {
    		if (users === undefined && !('users' in $$props || $$self.$$.bound[$$self.$$.props['users']])) {
    			console.warn("<ToDo> was created without expected prop 'users'");
    		}

    		if (tasks === undefined && !('tasks' in $$props || $$self.$$.bound[$$self.$$.props['tasks']])) {
    			console.warn("<ToDo> was created without expected prop 'tasks'");
    		}

    		if (projects === undefined && !('projects' in $$props || $$self.$$.bound[$$self.$$.props['projects']])) {
    			console.warn("<ToDo> was created without expected prop 'projects'");
    		}
    	});

    	const writable_props = ['users', 'tasks', 'projects'];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<ToDo> was created with unknown prop '${key}'`);
    	});

    	function div_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			container = $$value;
    			$$invalidate(0, container);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('users' in $$props) $$invalidate(1, users = $$props.users);
    		if ('tasks' in $$props) $$invalidate(2, tasks = $$props.tasks);
    		if ('projects' in $$props) $$invalidate(3, projects = $$props.projects);
    	};

    	$$self.$capture_state = () => ({
    		onMount,
    		ToDo: $a,
    		users,
    		tasks,
    		projects,
    		container
    	});

    	$$self.$inject_state = $$props => {
    		if ('users' in $$props) $$invalidate(1, users = $$props.users);
    		if ('tasks' in $$props) $$invalidate(2, tasks = $$props.tasks);
    		if ('projects' in $$props) $$invalidate(3, projects = $$props.projects);
    		if ('container' in $$props) $$invalidate(0, container = $$props.container);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [container, users, tasks, projects, div_binding];
    }

    class ToDo_1 extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { users: 1, tasks: 2, projects: 3 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "ToDo_1",
    			options,
    			id: create_fragment$1.name
    		});
    	}

    	get users() {
    		throw new Error("<ToDo>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set users(value) {
    		throw new Error("<ToDo>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get tasks() {
    		throw new Error("<ToDo>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set tasks(value) {
    		throw new Error("<ToDo>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get projects() {
    		throw new Error("<ToDo>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set projects(value) {
    		throw new Error("<ToDo>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    function getData() {
      const tasks = [
        {
          id: "temp://1652991560212",
          project: "introduction",
          text: "Greetings, everyone! \u{1F44B} \nI'm DHTMLX To Do List.",
          priority: 1,
        },
        {
          id: "1652374122964",
          project: "introduction",
          text: "You can assign task performers and due dates using the menu.",
          assigned: ["user_4", "user_1", "user_2", "user_3"],
          due_date: "2033-03-08T21:00:00.000Z",
          priority: 2,
        },
        {
          id: "temp://1652991560250",
          project: "introduction",
          text: "You can also use tags, it's very convenient: #tag",
          priority: 3,
        },
        {
          id: "1652376017408",
          project: "introduction",
          text: "Select this task and then press Enter to create the task below \u{1F447}",
        },
        {
          id: "1652376017412",
          project: "introduction",
          parent: null,
          text: "If you press Tab, this task will become a subtask. To edit it, press Ctrl (Cmd) + Enter.",
          assigned: ["user_4"],
        },
        {
          id: "1652097809881",
          project: "introduction",
          text: "You can create tasks with an infinite number of subtasks.",
          assigned: ["user_4"],
          collapsed: false,
        },
        {
          id: "1652097809882",
          project: "introduction",
          parent: "1652097809881",
          text: "Use the Tab and Shift + Tab keys for this.",
          checked: false,
        },
        {
          id: "1652097809887",
          project: "introduction",
          parent: "1652097809881",
          text: "Select and press Ctrl (Cmd) + Arrow up / Arrow down to change the task order.",
          checked: false,
        },
        {
          id: "1652097809883",
          project: "introduction",
          parent: "1652097809881",
          text: "Another example of a task with a subtask.",
          collapsed: false,
        },
        {
          id: "1652097809884",
          project: "introduction",
          parent: "1652097809883",
          text: "I am a subtask with an assignee.",
          assigned: ["user_4", "user_3", "user_2", "user_1"],
        },
        {
          id: "1652382019560",
          project: "introduction",
          parent: "1652097809883",
          text: "I am a completed subtask.",
          checked: true,
        },
        {
          id: "1652376017388",
          project: "introduction",
          parent: null,
          text: "Example of a collapsed task with subtasks. Press the right arrow key to expand the task, and then the left arrow key to collapse it.",
          checked: false,
          collapsed: true,
        },
        {
          id: "1652376017393",
          project: "introduction",
          parent: "1652376017388",
          text: "Flying into space",
          checked: true,
        },
        {
          id: "1652376017394",
          project: "introduction",
          parent: "1652376017388",
          text: "Flying to the Moon",
          checked: true,
        },
        {
          id: "1652378575570",
          project: "introduction",
          parent: "1652376017388",
          text: "Flying to the Mars",
        },
        {
          id: "1652374122969",
          project: "introduction",
          parent: null,
          text: "To mark a task as completed, press the spacebar or click on the checkbox.",
          checked: true,
          assigned: ["user_2"],
          due_date: "2022-03-08T21:00:00.000Z",
        },
        {
          id: "1652097809895",
          project: "introduction",
          parent: null,
          text: "You can also select a task and use keyboard shortcuts Ctrl (Cmd) + D or Ctrl (Cmd) + C and Ctrl (Cmd) + V to copy and paste it. \n\nShift+Enter in edit mode allows you to create a new paragraph. This is also an example of a task with long text. The text can be as long as you need. ",
          checked: false,
        },
        {
          id: "1652376017415",
          project: "introduction",
          parent: null,
          text: "I'm an overdue task. Select this task and then press Enter to create a task below.",
          due_date: "2021-06-14T21:00:00.000Z",
          assigned: ["user_1", "user_2"],
        },
        {
          id: "widgets",
          project: "widgets",
          text: "\u{1F389} DHTMLX widgets",
        },
        {
          id: "gantt",
          project: "widgets",
          parent: "widgets",
          text: "Gantt",
        },
        {
          id: "scheduler",
          project: "widgets",
          parent: "widgets",
          text: "Scheduler",
        },
        {
          id: "diagram",
          project: "widgets",
          parent: "widgets",
          text: "Diagram",
        },
        {
          id: "suite",
          project: "widgets",
          parent: "widgets",
          text: "Suite",
          collapsed: true,
        },
        {
          id: "kanban",
          project: "widgets",
          parent: "widgets",
          text: "Kanban",
        },
        {
          id: "spreadsheet",
          project: "widgets",
          parent: "widgets",
          text: "Spreadsheet",
        },
        {
          id: "pivot",
          project: "widgets",
          parent: "widgets",
          text: "Pivot",
        },
        {
          id: "vault",
          project: "widgets",
          parent: "widgets",
          text: "Vault",
        },
        {
          id: "richtext",
          project: "widgets",
          parent: "widgets",
          text: "Richtext",
        },
        {
          id: "todolist",
          project: "widgets",
          parent: "widgets",
          text: "To Do List",
        },
        {
          id: "calendar",
          project: "widgets",
          parent: "suite",
          text: "Calendar",
        },
        {
          id: "chat",
          project: "widgets",
          parent: "suite",
          text: "Chart",
        },
        {
          id: "corpicker",
          project: "widgets",
          parent: "suite",
          text: "ColorPicker",
        },
        {
          id: "combobox",
          project: "widgets",
          parent: "suite",
          text: "ComboBox",
        },
        {
          id: "dataview",
          project: "widgets",
          parent: "suite",
          text: "DataView",
        },
        {
          id: "datepicker",
          project: "widgets",
          parent: "suite",
          text: "DatePicker",
        },
        {
          id: "form",
          project: "widgets",
          parent: "suite",
          text: "Form",
        },
        {
          id: "grid",
          project: "widgets",
          parent: "suite",
          text: "Grid",
        },
        {
          id: "layout",
          project: "widgets",
          parent: "suite",
          text: "Layout",
        },
        {
          id: "list",
          project: "widgets",
          parent: "suite",
          text: "List",
        },
        {
          id: "menu",
          project: "widgets",
          parent: "suite",
          text: "Menu",
        },
        {
          id: "message",
          project: "widgets",
          parent: "suite",
          text: "Message",
        },
        {
          id: "pagination",
          project: "widgets",
          parent: "suite",
          text: "Pagination",
        },
        {
          id: "popup",
          project: "widgets",
          parent: "suite",
          text: "Popup",
        },
        {
          id: "ribbon",
          project: "widgets",
          parent: "suite",
          text: "Ribbon",
        },
        {
          id: "sidebar",
          project: "widgets",
          parent: "suite",
          text: "Sidebar",
        },
        {
          id: "slider",
          project: "widgets",
          parent: "suite",
          text: "Slider",
        },
        {
          id: "tabbar",
          project: "widgets",
          parent: "suite",
          text: "Tabbar",
        },
        {
          id: "timepicker",
          project: "widgets",
          parent: "suite",
          text: "TimePicker",
        },
        {
          id: "toolbar",
          project: "widgets",
          parent: "suite",
          text: "Toolbar",
        },
        {
          id: "tree",
          project: "widgets",
          parent: "suite",
          text: "Tree",
        },
        {
          id: "treegrid",
          project: "widgets",
          parent: "suite",
          text: "TreeGrid",
        },
        {
          id: "window",
          project: "widgets",
          parent: "suite",
          text: "Window",
        },
      ];
      const users = [
        {
          id: "user_1",
          label: "Don Smith",
          avatar:
            "https://snippet.dhtmlx.com/codebase/data/common/img/02/avatar_61.jpg",
        },
        {
          id: "user_2",
          label: "Nadia Chasey",
          avatar:
            "https://snippet.dhtmlx.com/codebase/data/common/img/02/avatar_63.jpg",
        },
        {
          id: "user_3",
          label: "Mike Young",
          avatar:
            "https://snippet.dhtmlx.com/codebase/data/common/img/02/avatar_03.jpg",
        },
        {
          id: "user_4",
          label: "Elvira Webb",
          avatar:
            "https://snippet.dhtmlx.com/codebase/data/common/img/02/avatar_33.jpg",
        },
      ];
      const projects = [
        {
          id: "introduction",
          label: "Introduction to DHTMLX To Do List",
        },
        {
          id: "widgets",
          label: "Our widgets",
        },
      ];
      return { tasks, users, projects };
    }

    /* src/App.svelte generated by Svelte v3.59.2 */

    function create_fragment(ctx) {
    	let stub;
    	let current;

    	stub = new ToDo_1({
    			props: {
    				users: /*users*/ ctx[0],
    				tasks: /*tasks*/ ctx[1],
    				projects: /*projects*/ ctx[2]
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(stub.$$.fragment);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			mount_component(stub, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(stub.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(stub.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(stub, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	const { users, tasks, projects } = getData();
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Stub: ToDo_1, getData, users, tasks, projects });
    	return [users, tasks, projects];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
      target: document.body,
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
