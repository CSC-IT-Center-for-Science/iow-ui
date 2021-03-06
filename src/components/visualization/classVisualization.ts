import { IAttributes, IQService, IScope, ITimeoutService, IPromise, IWindowService } from 'angular';
import { LanguageService } from '../../services/languageService';
import { VisualizationService, ClassVisualization } from '../../services/visualizationService';
import { ChangeListener, Show } from '../contracts';
import * as joint from 'jointjs';
import { module as mod }  from './module';
import { Uri } from '../../entities/uri';
import { first, arraysAreEqual, normalizeAsArray } from '../../utils/array';
import { UserService } from '../../services/userService';
import { ConfirmationModal } from '../common/confirmationModal';
import { SessionService, FocusLevel, NameType } from '../../services/sessionService';
import { VisualizationPopoverDetails } from './popover';
import { ShadowClass, createClassElement, createAssociationLink } from './diagram';
import { PaperHolder } from './paperHolder';
import { ClassInteractionListener } from './contract';
import { moveOrigin, scale, focusElement, centerToElement, scaleToFit } from './paperUtil';
import { adjustElementLinks, layoutGraph, VertexAction, calculateLabelPosition } from './layout';
import { Localizer } from '../../utils/language';
import { ifChanged, modalCancelHandler } from '../../utils/angular';
import { coordinatesAreEqual, centerToPosition, copyVertices } from '../../utils/entity';
import { mapOptional, requireDefined, Optional } from '../../utils/object';
import { Class, Property } from '../../entities/class';
import { Predicate } from '../../entities/predicate';
import { Model } from '../../entities/model';
import {
  ModelPositions, AssociationTargetPlaceholderClass, VisualizationClass,
  AssociationPropertyPosition
} from '../../entities/visualization';
import { Coordinate } from '../../entities/contract';
import { NotificationModal } from '../common/notificationModal';
import { InteractiveHelpService } from '../../help/services/interactiveHelpService';
import * as moment from 'moment';
import { ContextMenuTarget } from './contextMenu';
import { ModelPageActions } from '../model/modelPage';

mod.directive('classVisualization', () => {
  return {
    restrict: 'E',
    scope: {
      selection: '=',
      model: '=',
      modelPageActions: '='
    },
    template: `
               <div class="visualization-buttons">
                 <a role="button" class="btn btn-default btn-xs" ng-mousedown="ctrl.zoomOut()" ng-mouseup="ctrl.zoomOutEnded()"><i class="fa fa-search-minus"></i></a>
                 <a role="button" class="btn btn-default btn-xs" ng-mousedown="ctrl.zoomIn()" ng-mouseup="ctrl.zoomInEnded()"><i class="fa fa-search-plus"></i></a>
                 <a role="button" class="btn btn-default btn-xs" ng-click="ctrl.fitToContent()"><i class="fa fa-arrows-alt"></i></a>
                 <a role="button" ng-show="ctrl.canFocus()" class="btn btn-default btn-xs" ng-click="ctrl.centerToSelectedClass()"><i class="fa fa-crosshairs"></i></a>
                 <span ng-show="ctrl.canFocus()">
                   <a role="button" class="btn btn-default btn-xs" ng-click="ctrl.focusOut()"><i class="fa fa-angle-left"></i></a>
                   <div class="focus-indicator"><i>{{ctrl.renderSelectionFocus()}}</i></div>
                   <a role="button" class="btn btn-default btn-xs" ng-click="ctrl.focusIn()"><i class="fa fa-angle-right"></i></a>
                 </span>
                 <a role="button" class="btn btn-default btn-xs" ng-click="ctrl.toggleShowName()"><i>{{ctrl.showNameLabel | translate}}</i></a>
                 <a role="button" class="btn btn-default btn-xs" ng-show="ctrl.canSave()" ng-disabled="ctrl.modelPositions.isPristine()" ng-click="ctrl.savePositions()"><i class="fa fa-save"></i></a>
                 <a role="button" class="btn btn-default btn-xs" ng-disabled="ctrl.saving" ng-click="ctrl.layoutPersistentPositions()" ng-context-menu="ctrl.relayoutPositions()"><i class="fa fa-refresh"></i></a>
                 <div class="btn-group" uib-dropdown is-open="ctrl.exportOpen" ng-if="ctrl.downloads">
                  <button class="btn btn-default btn-xs" uib-dropdown-toggle><i class="fa fa-download"></i>&nbsp;<span class="caret"></span></button>
                    <ul class="dropdown-menu" role="menu" ng-if="ctrl.exportOpen">
                      <li role="menuitem" ng-repeat="download in ctrl.downloads track by download.name">
                        <a target="_self" download="{{download.filename}}" ng-href="{{download.href}}" ng-click="download.onClick()">{{download.name}}</a>
                      </li>
                    </ul>
                  </div>
               </div>
               <canvas style="display:none; background-color: white"></canvas>
               <visualization-popover details="ctrl.popoverDetails" context="ctrl.model"></visualization-popover>
               <visualization-context-menu ng-if="ctrl.contextMenuTarget" target="ctrl.contextMenuTarget" model="ctrl.model" model-page-actions="ctrl.modelPageActions"></visualization-context-menu>
               <ajax-loading-indicator class="loading-indicator" ng-show="ctrl.loading"></ajax-loading-indicator>
    `,
    bindToController: true,
    controllerAs: 'ctrl',
    require: 'classVisualization',
    link($scope: IScope, element: JQuery, _attributes: IAttributes, controller: ClassVisualizationController) {
      element.addClass('visualization-container');
      controller.paperHolder = new PaperHolder(element, controller);
      controller.svg = () => element.find('svg')[0] as any as SVGElement;
      controller.canvas = element.find('canvas')[0] as HTMLCanvasElement;

      const setDimensions = () => {
        controller.dimensionChangeInProgress = true;
        const paper = controller.paper;
        const xd = paper.options.width - element.width();
        const yd = paper.options.height - element.height();

        if (xd || yd) {
          paper.setDimensions(element.width(), element.height());
          moveOrigin(paper, xd / 2, yd / 2);
          window.setTimeout(setDimensions);
        } else {
          const canvas = controller.canvas;
          canvas.width = element.width();
          canvas.height = element.height();
          controller.dimensionChangeInProgress = false;
        }
      };

      const setDimensionsIfNotAlreadyInProgress = () => {
        if (!controller.dimensionChangeInProgress) {
          setDimensions();
        }
      };

      const setClickType = (event: MouseEvent) => controller.clickType = event.which === 3 ? 'right' : 'left';

      // init
      window.setTimeout(setDimensions);
      controller.setDimensions = () => window.setTimeout(setDimensionsIfNotAlreadyInProgress);
      window.addEventListener('resize', setDimensionsIfNotAlreadyInProgress);
      window.addEventListener('mousedown', setClickType);

      $scope.$on('$destroy', () => {
        window.removeEventListener('resize', setDimensions);
        window.removeEventListener('mousedown', setClickType);
      });
    },
    controller: ClassVisualizationController
  };
});

class ClassVisualizationController implements ChangeListener<Class|Predicate>, ClassInteractionListener {

  selection: Class|Predicate;

  model: Model;
  modelPageActions: ModelPageActions;

  loading: boolean;

  zoomInHandle: number;
  zoomOutHandle: number;

  dimensionChangeInProgress: boolean;

  paperHolder: PaperHolder;

  visible = true;
  saving = false;
  operationQueue: (() => void)[] = [];

  classVisualization: ClassVisualization;
  persistentPositions: ModelPositions;

  setDimensions: () => void;

  popoverDetails: VisualizationPopoverDetails|null;

  localizer: Localizer;

  clickType: 'left'|'right' = 'left';
  contextMenuTarget: Optional<ContextMenuTarget>;

  exportOpen = false;
  svg: () => SVGElement;
  canvas: HTMLCanvasElement;
  downloads: Download[];

  /* @ngInject */
  constructor(private $scope: IScope,
              private $q: IQService,
              private $timeout: ITimeoutService,
              private $window: IWindowService,
              private visualizationService: VisualizationService,
              private languageService: LanguageService,
              private userService: UserService,
              private sessionService: SessionService,
              private interactiveHelpService: InteractiveHelpService,
              private confirmationModal: ConfirmationModal,
              private notificationModal: NotificationModal) {

    this.modelPageActions.addListener(this);

    $scope.$watch(() => this.model, () => this.refresh());
    $scope.$watch(() => this.selection, ifChanged((newSelection, oldSelection) => {
      if (!newSelection || !oldSelection) {
        // Need to do this on next frame since selection change will change visualization size
        window.setTimeout(() => this.queueWhenNotVisible(() => this.focusSelection(false)));
      } else {
        this.focusSelection(false);
      }
    }));
    $scope.$watch(() => this.selectionFocus, ifChanged(() => this.focusSelection(false)));

    if (Modernizr.bloburls) {
      this.downloads = []; // set as empty array which indicates that exports are supported
      $scope.$watch(() => this.exportOpen, open => {
        if (open) {
          this.revokePreviousDownloads();
          this.generateExports().then(downloads => this.downloads = downloads);
        }
      });

      $scope.$on('$destroy', () => this.revokePreviousDownloads());
    }

    $scope.$on('$destroy', () => this.paperHolder.clean());
  }

  revokePreviousDownloads() {
    for (const download of this.downloads) {
      this.$window.URL.revokeObjectURL(download.href);
    }
  }

  generateExports(): IPromise<Download[]> {

    const UTF8_BOM = '\ufeff';
    const svgBlob = new Blob([UTF8_BOM, this.svgToString()], { type: 'image/svg+xml;charset=utf-8' });

    const filenameForExtension = (extension: string) =>
      `${this.model.prefix}-visualization-${moment().format('YYYY-MM-DD')}.${extension.toLowerCase()}`;

    const createDownload = (blob: Blob, extension: string) => {
      return {
        name: extension.toUpperCase(),
        filename: filenameForExtension(extension),
        href: this.$window.URL.createObjectURL(blob),
        onClick: () => {
          if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveOrOpenBlob(blob, filenameForExtension(extension));
          }
        }
      };
    };

    return this.svgToPng(svgBlob)
      .then(pngBlob => [createDownload(pngBlob, 'png'), createDownload(svgBlob, 'svg')],
        _err => [createDownload(svgBlob, 'svg')]);
  }

  svgToPng(svgBlob: Blob): IPromise<Blob> {

    const deferred = this.$q.defer();
    const canvas = this.canvas;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const svgURL = this.$window.URL.createObjectURL(svgBlob);

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    img.onload = () => {

      // Timeout hack for IE which incorrectly calls onload even when loading isn't actually ready
      setTimeout(() => {

        ctx.drawImage(img, 0, 0);
        this.$window.URL.revokeObjectURL(svgURL);

        try {
          canvas.toBlob(pngBlob => {
            if (pngBlob) {
              deferred.resolve(pngBlob);
            } else {
              deferred.reject('Null result');
            }
          }, 'image/png');
        } catch (e) {
          console.log('Cannot export PNG');
          deferred.reject(e);
        }
      });
    };

    img.src = svgURL;

    return deferred.promise;
  }

  svgToString() {
    // brutal way to inject styles to the document but creating new dom hierarchy seems to be impossible to get to work with IE
    return new XMLSerializer().serializeToString(this.svg())
      .replace('</svg>', '<style>' + require('!raw!sass!../../styles/classVisualizationSvgExport.scss') + '</style></svg>');
  }

  get selectionFocus() {
    return this.sessionService.visualizationFocus || FocusLevel.ALL;
  }

  set selectionFocus(value: FocusLevel) {
    this.sessionService.visualizationFocus = value;
  }

  get showName() {
    return this.sessionService.showName || NameType.LABEL;
  }

  set showName(value: NameType) {
    this.sessionService.showName = value;
  }

  get paper(): joint.dia.Paper {
    return this.paperHolder.getPaper(this.model);
  }

  get graph(): joint.dia.Graph {
    return <joint.dia.Graph> this.paper.model;
  }

  get modelPositions() {
    return this.classVisualization && this.classVisualization.positions;
  }

  canSave() {
    return this.interactiveHelpService.isClosed() && this.userService.user.isMemberOf(this.model.group);
  }

  savePositions() {
    this.userService.ifStillLoggedIn(() => {
      this.confirmationModal.openVisualizationLocationsSave()
        .then(() => {
          this.saving = true;
          this.visualizationService.updateModelPositions(this.model, this.modelPositions)
            .then(() => {
              this.modelPositions.setPristine();
              this.persistentPositions = this.modelPositions.clone();
              this.saving = false;
            });
        }, modalCancelHandler);
    }, () => this.notificationModal.openNotLoggedIn());
  }

  relayoutPositions() {
    this.loading = true;
    this.modelPositions.clear();
    this.layoutAndFocus(false)
      .then(() => this.loading = false);
  }

  layoutPersistentPositions() {
    this.loading = true;
    this.modelPositions.resetWith(this.persistentPositions);
    this.layoutPositionsAndFocus(false)
      .then(() => this.loading = false);
  }

  refresh(invalidateCache: boolean = false) {
    if (this.model) {

      this.localizer = this.languageService.createLocalizer(this.model);
      this.paperHolder.setVisible(this.model);

      if (invalidateCache || this.graph.getCells().length === 0) {
        this.loading = true;
        this.operationQueue = [];
        this.visualizationService.getVisualization(this.model)
          .then(visualization => {
            // Hackish way to apply scope outside potentially currently running digest cycle
            visualization.addPositionChangeListener(() => this.$timeout(() => {}));
            this.classVisualization = visualization;
            this.persistentPositions = this.modelPositions.clone();
            this.initialize();
          });
      }
    }
  }

  queueWhenNotVisible(operation: () => void) {
    this.operationQueue.push(operation);

    if (this.visible) {
      this.executeQueue();
    }
  }

  executeQueue() {
    if (this.dimensionChangeInProgress || !this.visible) {
      setTimeout(() => this.executeQueue(), 200);
    } else {
      setTimeout(() => {
        for (let i = this.operationQueue.length - 1; i >= 0; i--) {
          this.operationQueue[i]();
        }
        this.operationQueue = [];
      });
    }
  }

  initialize() {
    this.queueWhenNotVisible(() => {
      this.graph.resetCells(this.createCells(this.classVisualization));

      const forceFitToAllContent = this.selection && this.selection.id.equals(this.model.rootClass);
      this.layoutPositionsAndFocus(forceFitToAllContent).then(() => {
        this.adjustAllLinks(VertexAction.KeepPersistent);
        this.loading = false;
      });
    });
  }

  onDelete(item: Class|Predicate) {
    this.queueWhenNotVisible(() => {
      if (item instanceof Class) {
        this.removeClass(item);
      }
    });
  }

  onEdit(newItem: Class|Predicate, oldItem: Class|Predicate|null) {
    this.queueWhenNotVisible(() => {
      // id change can cause massive association realignment in the server
      if (oldItem && newItem.id.notEquals(oldItem.id)) {
        // FIXME: api should block until writes are done and not return inconsistent data
        this.loading = true;
        this.$timeout(() => this.refresh(true), 500);
      } else if (newItem instanceof Class) {
        this.updateClassAndLayout(newItem, mapOptional(oldItem, item => item.id));
      }
    });
  }

  onAssign(item: Class|Predicate) {
    this.queueWhenNotVisible(() => {
      if (item instanceof Class) {
        this.updateClassAndLayout(item);
      }
    });
  }

  layoutPositionsAndFocus(forceFitToAllContent: boolean) {
    const withoutPositionIds = this.classVisualization.getClassIdsWithoutPosition();
    const layoutAll = withoutPositionIds.length === this.classVisualization.size;
    const ids = layoutAll ? undefined : withoutPositionIds;

    return this.layoutAndFocus(forceFitToAllContent, ids);
  }

  layoutAndFocus(forceFitToAllContent: boolean, onlyClassIds?: Uri[] /* // undefined ids means layout all */) {

    const layout = () => {
      if (onlyClassIds && onlyClassIds.length === 0) {
        return this.$q.when();
      } else {
        return layoutGraph(this.$q, this.graph, !!this.model.rootClass, onlyClassIds ? onlyClassIds : []);
      }
    };

    return layout().then(() => {
      // Delay focus because dom needs to be repainted
      window.setTimeout(() => this.focusSelection(forceFitToAllContent));
    });
  }

  private updateClassAndLayout(klass: Class, oldId?: Uri|null) {

    const creation = !oldId;
    const idChanged = oldId && klass.id.notEquals(oldId);
    const oldIdIsAssociationTarget = oldId && this.isAssociationTarget(oldId);

    if (idChanged) {
      this.modelPositions.changeClassId(oldId!, klass.id);
    }

    const addedClasses = this.addOrReplaceClass(klass);

    if (idChanged) {
      if (oldIdIsAssociationTarget) {
        addedClasses.push(oldId!);
        this.replaceClass(new AssociationTargetPlaceholderClass(oldId!, this.model));
      } else {
        this.removeClass(oldId!);
      }
    }

    if (addedClasses.length > 0) {
      this.loading = true;
      this.layoutAndFocus(false, addedClasses.filter(classId => creation || klass.id.notEquals(classId)))
        .then(() => {
          if (oldIdIsAssociationTarget) {
            this.adjustElementLinks([oldId!], VertexAction.Reset);
          }

          this.adjustElementLinks([klass.id], VertexAction.KeepPersistent);
          this.loading = false;
        });
    } else {
      // Delay focus because dom needs to be repainted
      setTimeout(() => this.focusSelection(false));
    }
  }

  adjustAllLinks(vertexAction: VertexAction) {
    this.adjustElementLinks(null, vertexAction);
  }

  adjustElementLinks(classIds: Uri[]|null, vertexAction: VertexAction) {

    const alreadyAdjusted = new Set<string>();

    if (classIds) {
      for (const classId of classIds) {
        const element = this.graph.getCell(classId.toString());
        if (element instanceof joint.dia.Element) {
          adjustElementLinks(this.paper, <joint.dia.Element> element, alreadyAdjusted, this.modelPositions, vertexAction);
        }
      }
    } else {
      for (const element of this.graph.getElements()) {
        adjustElementLinks(this.paper, element, alreadyAdjusted, this.modelPositions, vertexAction);
      }
    }
  }

  onResize(show: Show) {

    this.visible = show !== Show.Selection;
    this.setDimensions();

    if (this.visible) {
      this.executeQueue();
    }
  }

  canFocus() {
    return this.selection instanceof Class;
  }

  renderSelectionFocus() {
    switch (this.selectionFocus) {
      case FocusLevel.ALL:
        return '**';
      case FocusLevel.INFINITE_DEPTH:
        return '*';
      default:
        return (<number> this.selectionFocus).toString();
    }
  }

  focusIn() {
    if (this.selectionFocus < FocusLevel.ALL) {
      this.selectionFocus++;
    }
  }

  focusOut() {
    if (this.selectionFocus > FocusLevel.DEPTH1) {
      this.selectionFocus--;
    }
  }

  toggleShowName() {
    this.showName = (this.showName + 1) % 3;
  }

  zoomIn() {
    this.zoomInHandle = window.setInterval(() => scale(this.paper, 0.01), 10);
  }

  zoomInEnded() {
    window.clearInterval(this.zoomInHandle);
  }

  zoomOut() {
    this.zoomOutHandle = window.setInterval(() => scale(this.paper, -0.01), 10);
  }

  zoomOutEnded() {
    window.clearInterval(this.zoomOutHandle);
  }

  fitToContent(onlyVisible: boolean = false) {
    this.queueWhenNotVisible(() => {
      scaleToFit(this.paper, this.graph, onlyVisible);
    });
  }

  centerToSelectedClass() {
    const element = this.findElementForSelection();
    if (element) {
      centerToElement(this.paper, element);
    }
  }

  get showNameLabel() {
    switch (this.showName) {
      case NameType.ID:
        return 'ID';
      case NameType.LABEL:
        return 'Label';
      case NameType.LOCAL_ID:
        return 'Local ID';
      default:
        throw new Error('Unsupported show name type: ' + this.showName);
    }
  }

  onClassContextMenu(classId: string, coordinate: Coordinate): void {

    if (this.userService.user.isLoggedIn()) {
      this.userService.ifStillLoggedIn(() => {

        const klass = this.classVisualization.hasClass(classId) ? this.classVisualization.getClassById(classId)
                                                                : new AssociationTargetPlaceholderClass(new Uri(classId, this.model.context), this.model);
        this.contextMenuTarget = { coordinate, target: klass };
      }, () => this.notificationModal.openNotLoggedIn());
    }
  }

  onDismissContextMenu(): void {
    this.$scope.$apply(() => {
      this.contextMenuTarget = null;
    });
  }

  onClassClick(classId: string): void {
    this.modelPageActions.select({ id: new Uri(classId, {}), selectionType: 'class' });
  }

  onClassHover(classId: string, coordinate: Coordinate): void {

    const klass = this.classVisualization.getClassById(classId);

    if (klass) {
      this.$scope.$applyAsync(() => {
        this.popoverDetails = {
          coordinate: coordinate,
          heading: klass.label,
          comment: klass.comment
        };
      });
    }
  }

  onPropertyHover(classId: string, propertyId: string, coordinate: Coordinate): void {

    const klass = this.classVisualization.getClassById(classId);

    if (klass) {
      this.$scope.$applyAsync(() => {

        const property = requireDefined(first(klass.properties, property => property.internalId.toString() === propertyId));

        this.popoverDetails = {
          coordinate: coordinate,
          heading: property.label,
          comment: property.comment
        };
      });
    }
  }

  onHoverExit(): void {
    this.$scope.$applyAsync(() => {
      this.popoverDetails = null;
    });
  }

  focusSelection(forceFitToAllContent: boolean) {
    focusElement(this.paper, this.graph, this.findElementForSelection(), forceFitToAllContent, this.selectionFocus);
  }

  private findElementForSelection(): joint.dia.Element|null {

    const classOrPredicate = this.selection;

    if (classOrPredicate instanceof Class && !classOrPredicate.unsaved) {
      const cell = this.graph.getCell(classOrPredicate.id.uri);
      if (cell) {
        if (cell.isLink()) {
          throw new Error('Cell must be an element');
        } else {
          return <joint.dia.Element> cell;
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  private removeClass(klass: Class|Uri) {

    const id: Uri = klass instanceof Class ? klass.id : <Uri> klass;

    this.classVisualization.removeClass(id.toString());

    // remove to be unreferenced shadow classes
    for (const element of this.graph.getNeighbors(<joint.dia.Element> this.graph.getCell(id.uri))) {
      if (element instanceof ShadowClass && this.graph.getConnectedLinks(element).length === 1) {
        element.remove();
      }
    }

    if (this.isAssociationTarget(klass)) {
      this.replaceClass(new AssociationTargetPlaceholderClass(id, this.model));
    } else {
      this.graph.getCell(id.uri).remove();
    }
  }

  private addOrReplaceClass(klass: VisualizationClass) {

    this.classVisualization.addOrReplaceClass(klass);

    if (this.isExistingClass(klass.id)) {
      return this.replaceClass(klass);
    } else {
      return this.addClass(klass, true);
    }
  }

  private replaceClass(klass: VisualizationClass) {

    const oldElement = this.graph.getCell(klass.id.uri);
    const incomingLinks: joint.dia.Link[] = [];
    const oldOutgoingClassIds = new Set<string>();

    for (const link of this.graph.getConnectedLinks(oldElement)) {

      const targetId = link.attributes.target.id;
      const targetElement = this.graph.getCell(targetId);

      if (!klass.hasAssociationTarget(new Uri(targetId, {}))) {
        if (targetElement instanceof ShadowClass && this.graph.getConnectedLinks(targetElement).length === 1) {
          // Remove to be unreferenced shadow class
          targetElement.remove();
        }
      } else {
        oldOutgoingClassIds.add(targetId);
      }

      if (link.attributes.source.id === klass.id.uri) {
        // remove outgoing links since they will be added again
        link.remove();
      } else {
        incomingLinks.push(link);
      }
    }

    oldElement.remove();

    const addedClasses = this.addClass(klass, true);
    this.graph.addCells(incomingLinks);

    return addedClasses.filter(addedClass => !klass.id.equals(addedClass) && !oldOutgoingClassIds.has(addedClass.uri));
  }

  private addClass(klass: VisualizationClass, addAssociations: boolean) {
    const classElement = this.createClassElement(this.paper, klass);

    this.graph.addCell(classElement);

    if (addAssociations) {
      return this.addAssociations(klass).concat([klass.id]);
    } else {
      return [klass.id];
    }
  }

  private addAssociation(klass: VisualizationClass, association: Property) {

    let addedClass = false;
    const classPosition = this.modelPositions.getClass(klass.id);

    if (!this.isExistingClass(association.valueClass!)) {
      // set target location as source location for layout
      classPosition.setCoordinate(this.graph.getCell(klass.id.uri).attributes.position);
      this.addClass(new AssociationTargetPlaceholderClass(association.valueClass!, this.model), false);
      addedClass = true;
    }

    this.graph.addCell(this.createAssociationLink(klass, association, classPosition.getAssociationProperty(association.internalId)));

    return addedClass;
  }

  private addAssociations(klass: VisualizationClass) {
    const addedClasses: Uri[] = [];

    for (const association of klass.associationPropertiesWithTarget) {
      const addedClass = this.addAssociation(klass, association);
      if (addedClass) {
        addedClasses.push(association.valueClass!);
      }
    }

    return addedClasses;
  }

  isExistingClass(klass: Class|Uri) {
    const id: Uri = klass instanceof Class ? klass.id : <Uri> klass;
    return !!this.graph.getCell(id.uri);
  }

  isAssociationTarget(klass: Class|Uri) {
    const id: Uri = klass instanceof Class ? klass.id : <Uri> klass;

    for (const link of this.graph.getLinks()) {
      if (link.attributes.target.id === id.uri) {
        return true;
      }
    }
    return false;
  }

  private createCells(visualization: ClassVisualization) {

    const associations: {klass: VisualizationClass, property: Property}[] = [];
    const classIds = visualization.getClassIds();

    const cells: joint.dia.Cell[] = [];

    for (const klass of visualization.getClasses()) {

      for (const property of klass.properties) {

        if (property.isAssociation() && property.valueClass) {
          if (!classIds.has(property.valueClass.uri)) {
            classIds.add(property.valueClass.uri);
            cells.push(this.createClassElement(this.paper, new AssociationTargetPlaceholderClass(property.valueClass, this.model)));
          }
          associations.push({klass, property});
        }
      }
      const element = this.createClassElement(this.paper, klass);

      cells.push(element);
    }

    for (const association of associations) {
      const associationPosition = this.modelPositions.getAssociationProperty(association.klass.id, association.property.internalId);
      const link = this.createAssociationLink(association.klass, association.property, associationPosition);
      cells.push(link);
    }

    return cells;
  }

  private get iowCellOptions() {
    return {
      showCardinality: this.model.isOfType('profile'),
      showName: this.showName,
      localizer: this.localizer
    };
  }

  private createClassElement(paper: joint.dia.Paper, klass: VisualizationClass): joint.dia.Element {

    const classCell = createClassElement(klass, () => this.iowCellOptions);
    const classPosition = this.modelPositions.getClass(klass.id);

    const onDiagramPositionChange = () => {
      const newCenter = classCell.getBBox().center();
      if (!coordinatesAreEqual(newCenter, classPosition.coordinate)) {
        const action = this.clickType === 'right' ? VertexAction.Reset : VertexAction.KeepAllButLoops;
        adjustElementLinks(paper, classCell, new Set<string>(), this.modelPositions, action);
        classPosition.setCoordinate(newCenter);
      }
    };

    const onPersistentPositionChange = (coordinate: Coordinate) => {
      const bbox = classCell.getBBox();
      const newPosition = centerToPosition(coordinate, bbox);

      if (coordinate && !coordinatesAreEqual(newPosition, bbox)) {
        classCell.position(newPosition.x, newPosition.y);
        adjustElementLinks(paper, classCell, new Set<string>(), this.modelPositions, VertexAction.KeepAll);
      }
    };

    // Initial position
    const position = this.modelPositions.getClass(klass.id);

    if (position.isDefined()) {
      onPersistentPositionChange(position.coordinate!);
    }

    classCell.on('change:position', onDiagramPositionChange);
    classPosition.changeListeners.push(onPersistentPositionChange);

    this.$scope.$watch(() => this.localizer.language, ifChanged(() => this.queueWhenNotVisible(classCell.updateModel)));
    this.$scope.$watch(() => this.showName, ifChanged(() => this.queueWhenNotVisible(classCell.updateModel)));

    return classCell;
  }

  private createAssociationLink(klass: VisualizationClass, association: Property, position: AssociationPropertyPosition): joint.dia.Link {

    const associationCell = createAssociationLink(klass, association, () => this.iowCellOptions);

    const onDiagramVerticesChange = () => {
      const propertyPosition = this.modelPositions.getAssociationProperty(klass.id, association.internalId);
      const vertices = normalizeAsArray(associationCell.get('vertices'));
      const oldVertices = propertyPosition.vertices;

      if (!arraysAreEqual(vertices, oldVertices, coordinatesAreEqual)) {
        propertyPosition.setVertices(copyVertices(normalizeAsArray(associationCell.get('vertices'))));
        associationCell.prop('labels/0/position', calculateLabelPosition(this.paper, this.graph, associationCell));
      }
    };

    const onPersistentVerticesChange = (vertices: Coordinate[]) => {
      const oldVertices = normalizeAsArray(associationCell.get('vertices'));

      if (!arraysAreEqual(vertices, oldVertices, coordinatesAreEqual)) {
        associationCell.set('vertices', copyVertices(vertices));
      }
    };

    // Initial vertices
    onPersistentVerticesChange(position.vertices);

    associationCell.on('change:vertices', onDiagramVerticesChange);
    position.changeListeners.push(onPersistentVerticesChange);

    this.$scope.$watch(() => this.localizer.language, ifChanged(() => this.queueWhenNotVisible(associationCell.updateModel)));
    this.$scope.$watch(() => this.showName, ifChanged(() => this.queueWhenNotVisible(associationCell.updateModel)));

    return associationCell;
  }
}

interface Download {
  name: string;
  filename: string;
  href: string;
  onClick: () => void;
}
