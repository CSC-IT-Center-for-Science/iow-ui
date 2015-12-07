import IAttributes = angular.IAttributes;
import IScope = angular.IScope;

export const mod = angular.module('iow.components.common');

mod.directive('keyControl', () => {
  'ngInject';
  return {
    restrict: 'A',
    controllerAs: 'keyControl',
    require: 'keyControl',
    link($scope: IScope, element: JQuery, attributes: IAttributes, controller: KeyControlController) {
      element.on('keydown', event => controller.keyPressed(event));
      $scope.$watch(element.attr('key-control') + '.length', (items: number) => controller.onItemsChange(items || 0));
    },
    controller: KeyControlController
  }
});

const arrowDown = 40;
const arrowUp = 38;
const pageDown = 34;
const pageUp = 33;
const enter = 13;

export class KeyControlController {

  itemCount: number = 0;
  selectionIndex: number = -1;

  private keyEventHandlers: {[key: number]: () => void} = {
    [arrowDown]: () => this.moveSelection(1),
    [arrowUp]: () => this.moveSelection(-1),
    [pageDown]: () => this.moveSelection(10),
    [pageUp]: () => this.moveSelection(-10),
    [enter]: () => this.selectSelection()
  };

  constructor(private $scope: IScope) {
  }

  onItemsChange(itemCount: number) {
    this.itemCount = itemCount;
    this.setSelection(-1);
  }

  keyPressed(event: JQueryEventObject) {
    const handler = this.keyEventHandlers[event.keyCode];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  private moveSelection(offset: number) {
    this.setSelection(Math.max(Math.min(this.selectionIndex + offset, this.itemCount-1), -1));
  }

  private setSelection(index: number) {
    this.selectionIndex = index;
    this.$scope.$broadcast('selectionMoved', this.selectionIndex);
  }

  private selectSelection() {
    this.$scope.$broadcast('selectionSelected', this.selectionIndex);
  }
}

