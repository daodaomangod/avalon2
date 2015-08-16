function scanNodeList(parent, vmodels) {
    var nodes = avalon.slice(parent.childNodes)
    scanNodeArray(nodes, vmodels)
}
var renderedCallbacks = []

function scanNodeArray(nodes, vmodels) {
    for (var i = 0, node; node = nodes[i++]; ) {
        switch (node.nodeType) {
            case 1:
                scanTag(node, vmodels) //扫描元素节点

                var elem = node

                if (!elem.msResolved && elem.parentNode && elem.parentNode.nodeType === 1) {

                    var library = isWidget(elem)

                    if (library && avalon.libraries[library]) {
                        var widget = elem.localName ? elem.localName.replace(library + ":", "") : elem.nodeName
                        var fullName = library + ":" + camelize(widget)
                        componentQueue.push({
                            library: library,
                            element: elem,
                            fullName: fullName,
                            widget: widget,
                            vmodels: vmodels,
                            name: "widget"
                        })
                        if (avalon.components[fullName]) {
                            avalon.clearHTML(elem)
                            avalon.component(fullName)
                        }
                    }
                }
                if (renderedCallbacks.length) {
                    while (fn = renderedCallbacks.pop()) {
                        fn.call(node)
                    }
                }

                break
            case 3:
                if (rexpr.test(node.nodeValue)) {
                    scanText(node, vmodels, i) //扫描文本节点
                }
                break
        }
    }
}

var componentQueue = []
var componentMethods = {
    $construct: function () {
        return avalon.mix.apply(null, arguments)
    },
    $ready: noop,
    $init: noop,
    $dispose: noop,
    $childReady: noop,
    $$template: function () {
        return this.$template
    }
}

avalon.components = {}
avalon.component = function (name, opts) {
    if (opts) {
        avalon.components[name] = avalon.mix({}, componentMethods, opts)
    }
    for (var i = 0, obj; obj = componentQueue[i]; i++) {
        if (name === obj.fullName) {
            componentQueue.splice(i, 1)
            i--;

            (function (host, defaults, elem, widget) {
                var dependencies = 1
                var library = host.library
                var global = avalon.libraries[library]
                //===========收集各种配置=======
                //从vmodels中得到业务数据
                var vmOpts = getOptionsFromVM(host.vmodels, elem.getAttribute("configs") || host.fullName)
                //从element的data-pager-xxx辅助指令中得到该组件的专有数据
                var elemOpts = avalon.getWidgetData(elem, widget)
                var parentDefinition
                if (host.$extends) {
                    var parentClass = avalon.components[host.$extends]
                    if (parentClass) {
                        parentDefinition = parentClass.$construct(defaults, vmOpts)
                    }
                }
                var componentDefinition = avalon.components[name].$construct(
                        parentDefinition || defaults, vmOpts, elemOpts)

                componentDefinition.$refs = {}
                componentDefinition.$id = elem.getAttribute("identifier") || generateID(widget)
                //==========构建VM=========
                var vm = avalon.define(componentDefinition) || {}
                elem.msResolved = 1

                elem = componentDefinition.$init(vm) || elem
                global.$init(vm)
              
                elem.innerHTML = componentDefinition.$$template()
                var child = elem.firstChild
                if (componentDefinition.$replace) {
                    child = elem.firstChild
                    elem.parentNode.replaceChild(child, elem)
                    child.msResolved = 1
                    elem = host.element = child
                }
                avalon.fireDom(elem.parentNode, "datasetchanged", {dependency: 1, library: library, vm: vm})
                var removeFn = avalon.bind(elem, "datasetchanged", function (e) {
                    if (isFinite(e.dependency) && e.library === library) {
                        dependencies += e.dependency
                        if (vm !== e.vm) {
                            componentDefinition.$childReady(vm, e)
                            global.$childReady(vm, e)
                            e.stopPropagation()
                        }
                    }

                    if (dependencies === 0) {
                        componentDefinition.$ready(vm)
                        global.$ready(vm, host)
                        avalon.unbind(elem, "datasetchanged", removeFn)
                        //==================
                        host.rollback = function () {
                            try {
                                componentDefinition.$dispose(vm)
                                global.$dispose(vm)
                            } catch (e) {
                            }
                            delete avalon.vmodels[vm.$id]
                        }
                        injectDisposeQueue(host, widgetList)
                        if (window.chrome) {
                            elem.addEventListener("DOMNodeRemovedFromDocument", function () {
                                setTimeout(rejectDisposeQueue)
                            })
                        }

                    }
                })
                avalon.scan(elem, [vm].concat(host.vmodels))

                avalon.vmodels[vm.$id] = vm

                if (!elem.childNodes.length) {
                    avalon.fireDom(elem, "datasetchanged", {dependency: -1, library: library, vm: vm})
                } else {
                    renderedCallbacks.push(function () {
                        avalon.fireDom(elem, "datasetchanged", {dependency: -1, library: library, vm: vm})
                    })
                }


            })(obj, avalon.mix(true, {}, avalon.components[name]), obj.element, obj.widget)// jshint ignore:line


        }
    }
}

avalon.fireDom = function (elem, type, opts) {
    if (DOC.createEvent) {
        var hackEvent = DOC.createEvent("Events");
        hackEvent.initEvent(type, true, true, opts)
        avalon.mix(hackEvent, opts)

        elem.dispatchEvent(hackEvent)
    } else {
        hackEvent = DOC.createEventObject()
        avalon.mix(hackEvent, opts)
        elem.fireEvent("on" + type, hackEvent)
    }
}


function getOptionsFromVM(vmodels, pre) {
    if (pre) {
        for (var i = 0, v; v = vmodels[i++]; ) {
            if (v.hasOwnProperty(pre) && typeof v[pre] === "object") {
                var vmOptions = v[pre]
                return vmOptions.$model || vmOptions
                break
            }
        }
    }
    return {}
}


avalon.libraries = []
avalon.library = function (name, opts) {
    if (DOC.namespaces) {
        DOC.namespaces.add(name, 'http://www.w3.org/1999/xlink');
    }
    avalon.libraries[name] = avalon.mix({
        $init: noop,
        $childReady: noop,
        $ready: noop,
        $dispose: noop
    }, opts || {})
}

avalon.library("ms")

function isWidget(el) { //如果为自定义标签,返回UI库的名字
    if (el.scopeName) {
        return el.scopeName
    }
    var fullName = el.localName
    var index = fullName && fullName.indexOf(":")
    if (index > 0) {
        return fullName.slice(0, index)
    }
}
//各种MVVM框架在大型表格下的性能测试
// https://github.com/RubyLouvre/avalon/issues/859


