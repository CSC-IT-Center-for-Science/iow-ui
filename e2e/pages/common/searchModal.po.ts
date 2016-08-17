import { Modal } from './modal.po';

export class SearchModal extends Modal {

  searchElement = this.element.element(by.model('ctrl.searchText'));
  searchResults = this.element.$('.search-results');

  search(text: string) {
    this.searchElement.sendKeys(text);
  }

  findResultElementByName(name: string) {
    return this.searchResults.element(by.cssContainingText('h5', name));
  }

  selectResult(name: string) {
    return browser.wait(protractor.until.elementLocated(by.css('search-results')))
      .then(() => this.findResultElementByName(name).click());
  }

  confirm() {
    this.element.$('modal-buttons button.confirm').click();
  }
}
